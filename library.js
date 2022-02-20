'use strict';

const nconf = require.main.require('nconf');
const _ = require('lodash');

const db = require.main.require('./src/database');
const meta = require.main.require('./src/meta');
const user = require.main.require('./src/user');
const topics = require.main.require('./src/topics');
const posts = require.main.require('./src/posts');
const slugify = require.main.require('./src/slugify');
const utils = require.main.require('./src/utils');
const utility = require('./lib/utility');

const plugin = {
	regex: /(?:^|\s|>|;|")(#[\w\-_]+)(?=[^>]*<)/g, // greatly simplified from mentions, but now only supports latin/alphanum
	_cache: {},
};
const removePunctuationSuffix = function (string) {
	return string.replace(/[!?.]*$/, '');
};

plugin.init = async () => {
	require('./lib/websockets');
};

plugin.parsePost = async (data) => {
	if (!data || !data.postData || !data.postData.content) {
		return data;
	}

	data.postData.content = await plugin.parseRaw(data.postData.content);
	return data;
};

plugin.parseRaw = async (content) => {
	const splitContent = utility.split(content, false, false, true);
	let matches = [];
	splitContent.forEach(function (cleanedContent, i) {
		if ((i & 1) === 0) {
			matches = matches.concat(cleanedContent.match(plugin.regex) || []);
		}
	});

	if (!matches.length) {
		return content;
	}

	matches = matches.filter(function (cur, idx) {
		// Eliminate duplicates
		return idx === matches.indexOf(cur);
	}).map(function (match) {
		/**
		 *	Javascript-favour of regex does not support lookaround,
		 *	so need to clean up the cruft by discarding everthing
		 *	before the @
		 */
		var atIndex = match.indexOf('#');
		return atIndex !== 0 ? match.slice(atIndex) : match;
	});

	// Clean up the string match
	matches = matches.map(removePunctuationSuffix);

	// TODO: Validate tag exists, w/ ACP option
	// db.exists(matches.filter(match => match.slice(1)));

	// Replace with anchor link
	matches.forEach((match) => {
		content = content.replace(match, `<a href="${nconf.get('relative_path')}/tags/${match.slice(1)}">${match}</a>`);
	});

	return content;
};

plugin.clean = function (input, isMarkdown, stripBlockquote, stripCode) {
	var split = utility.split(input, isMarkdown, stripBlockquote, stripCode);
	split = split.filter(function (x, i) {
		// only keep non-code/non-blockquote
		return (i & 1) === 0;
	});
	return split.join('');
};

plugin.onTopicCreateOrEdit = async (data) => {
	// During topic creation, mainPid is 0 since the post has not been created yet
	let isMainPost = data.topic ? data.topic.mainPid === 0 : false;
	if (data.post) {
		// This is a post edit action
		const mainPid = await topics.getTopicField(data.post.tid, 'mainPid');
		isMainPost = mainPid === data.post.pid;
	}

	// Tags are only tracked on the main post
	if (!isMainPost) {
		return data;
	}

	var cleanedContent = plugin.clean(data.data.content, true, true, true);
	var matches = cleanedContent.match(plugin.regex);

	if (!matches) {
		return data;
	}

	// Get rid of the cruft caught by the regex, at the start of the tag
	data.data.tags = [...data.data.tags, ...matches.map(slugify)];

	// Filter duplicates out
	data.data.tags = data.data.tags.filter((tag, idx) => data.data.tags.indexOf(tag) === idx);

	return data;
};

// We'd like to also store a separate zset for tags made on a per-post basis, so we index them after the fact
plugin.indexPost = async ({ post }) => {
	var cleanedContent = plugin.clean(post.content, true, true, true);
	var matches = cleanedContent.match(plugin.regex);
	const tid = await posts.getPostField(post.pid, 'tid');
	const topicTags = await db.getSetMembers(`topic:${tid}:tags`);

	if (!matches && !topicTags.length) {
		return;
	}

	matches = matches || [];
	matches = matches.map((match) => slugify(match));
	matches = matches.concat(topicTags);
	matches = _.uniq(matches);

	const scores = matches.map(Date.now);

	db.sortedSetsAdd(matches.map((match) => `tag:${match}:posts`), scores, post.pid);
};

// Whenever a specific tag page is loaded, remove the tids and use our own tids (via pids)
plugin.clobberTagTids = async ({ tag, tids, start, stop }) => {
	tag = utils.cleanUpTag(tag, meta.config.maximumTagLength);

	const pids = await db.getSortedSetRevRange('tag:' + tag + ':posts', start, stop);
	const newTids = await posts.getPostsFields(pids, ['tid']);
	tids = newTids.map((obj) => obj.tid);
	plugin._cache[tag] = pids;

	return { tag, tids, start, stop };
};

// By default tags page only returns tids, update the links to point to individual posts (via topic indices)
plugin.updateTagsPage = async (data) => {
	const tag = utils.cleanUpTag(data.templateData.tag, meta.config.maximumTagLength);
	const pids = plugin._cache[tag];
	const tids = data.templateData.topics.map((topic) => topic.tid);
	const index = await Promise.all(pids.map(async (pid, idx) => posts.getPidIndex(pid, tids[idx])));
	const teasers = await getTeasers(pids);

	data.templateData.topics.map((topic, idx) => {
		if (index[idx] > 0) {
			topic.slug = `${topic.slug}/${index[idx]}`;
			topic.teaser = teasers[idx];
		}
		delete topic.bookmark;

		return topic;
	});

	return data;
};

async function getTeasers(pids) {
	let postData = await posts.getPostsFields(pids, ['pid', 'uid', 'timestamp', 'tid', 'content']);
	postData = postData.filter((post) => post && post.pid);
	postData = postData.filter(Boolean);
	const uids = _.uniq(postData.map((post) => post.uid));

	const usersData = await user.getUsersFields(uids, ['uid', 'username', 'userslug', 'picture']);

	var users = {};
	usersData.forEach(function (user) {
		users[user.uid] = user;
	});
	postData.forEach(function (post) {
		// If the post author isn't represented in the retrieved users' data, then it means they were deleted, assume guest.
		if (!users.hasOwnProperty(post.uid)) {
			post.uid = 0;
		}

		post.user = users[post.uid];
		post.timestampISO = utils.toISOString(post.timestamp);
	});

	return postData;
}

// Update tag count for pagination purposes in /tag/:tag page
plugin.updateTagCounts = async ({ tag, count }) => {
	tag = utils.cleanUpTag(tag, meta.config.maximumTagLength);

	count = await db.sortedSetCard('tag:' + tag + ':posts');
	return { tag, count };
};

// Update tag counts on /tags
plugin.updateTagListCounts = async ({ tags }) => {
	await Promise.all(tags.map(async (tag) => {
		tag.value = utils.cleanUpTag(tag.value, meta.config.maximumTagLength);
		tag.score = await db.sortedSetCard(`tag:${tag.value}:posts`);
		return tag;
	}));

	return { tags };
};

module.exports = plugin;
