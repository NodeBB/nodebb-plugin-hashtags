'use strict';

const topics = nodebb.require('./src/topics');
const categories = nodebb.require('./src/categories');

const socket = nodebb.require('./src/socket.io/plugins');
socket.hashtags = {};

socket.hashtags.search = async (socket, data) => {
	if (data.query && data.query.length) {
		const tags = await topics.searchTags(data);
		return tags.map(tag => tag.value);
	}

	// Default, show nothing or whitelist if present
	if (!data.composerObj || !data.composerObj.cid) {
		return [];
	}
	const { 0: whitelist } = await categories.getTagWhitelist([data.composerObj.cid]);
	return whitelist;
};
