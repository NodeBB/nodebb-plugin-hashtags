'use strict';

const nconf = require.main.require('nconf');

const meta = require.main.require('./src/meta');
const topics = require.main.require('./src/topics');
const utils = require.main.require('./src/utils');
const controllers = require('./lib/controllers');
const utility = require('./lib/utility');

const plugin = {
	regex: /(?:^|\s|>|;|")(#[\w\-_]+)/g,	// greatly simplified from mentions, but now only supports latin/alphanum
};
const removePunctuationSuffix = function (string) {
	return string.replace(/[!?.]*$/, '');
};

plugin.init = function (params, callback) {
	const router = params.router;
	const hostMiddleware = params.middleware;
	// const hostControllers = params.controllers;

	router.get('/admin/plugins/hashtags', hostMiddleware.admin.buildHeader, controllers.renderAdminPage);
	router.get('/api/admin/plugins/hashtags', controllers.renderAdminPage);

	plugin.syncSettings(callback);
};

plugin.syncSettings = function (callback) {
	meta.settings.get('hashtags', function (err, settings) {
		if (err) {
			return callback(err);
		}

		plugin.settings = Object.assign((plugin.settings || {}), settings);
		callback();
	});
};

plugin.onSettingsChange = function (data) {
	if (data.plugin === 'hashtags') {
		plugin.settings = Object.assign((plugin.settings || {}), data.settings);
	}
};

plugin.addAdminNavigation = function (header, callback) {
	header.plugins.push({
		route: '/plugins/hashtags',
		icon: 'fa-tint',
		name: 'Hashtags',
	});

	callback(null, header);
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
	data.data.tags = [...data.data.tags, ...matches.map(utils.slugify)];

	// Filter duplicates out
	data.data.tags = data.data.tags.filter((tag, idx) => data.data.tags.indexOf(tag) === idx);

	return data;
};

module.exports = plugin;
