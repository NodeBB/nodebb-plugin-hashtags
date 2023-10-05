'use strict';

/* globals $, document, window, socket, app */

$(document).ready(function () {
	$(window).on('composer:autocomplete:init chat:autocomplete:init', function (ev, data) {
		let slugify;
		const strategy = {
			match: /\B#([^\s\n]*)?$/,
			search: function (term, callback) {
				// Get composer metadata
				var uuid = data.options.className && data.options.className.match(/dropdown-(.+?)\s/)[1];
				require(['composer', 'slugify'], function (composer, _slugify) {
					slugify = _slugify;
					socket.emit('plugins.hashtags.search', {
						query: term,
						composerObj: composer.posts[uuid],
					}, async function (err, tags) {
						if (err) {
							const alerts = await app.require('alerts');
							return alerts.error(err);
						}

						callback(tags);
					});
				});
			},
			index: 1,
			replace: function (hashtag) {
				hashtag = $('<div/>').html(hashtag).text();
				return '#' + slugify(hashtag, true) + ' ';
			},
			cache: true,
		};

		data.strategies.push(strategy);
	});

	$(window).on('action:composer.loaded', function (ev, data) {
		var composer = $('#cmp-uuid-' + data.post_uuid + ' .write');
		composer.attr('data-hashtags', '1');
	});
});
