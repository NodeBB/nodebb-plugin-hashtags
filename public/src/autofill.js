'use strict';

/* globals $, document, window, socket, app, utils */

$(document).ready(function () {
	console.log('here');
	$(window).on('composer:autocomplete:init chat:autocomplete:init', function (ev, data) {
		console.log(data);
		var strategy = {
			match: /\B#([^\s\n]*)?$/,
			search: function (term, callback) {
				// Get composer metadata
				var uuid = data.options.className && data.options.className.match(/dropdown-(.+?)\s/)[1];
				require(['composer'], function (composer) {
					socket.emit('plugins.hashtags.search', {
						query: term,
						composerObj: composer.posts[uuid],
					}, function (err, tags) {
						if (err) {
							return app.alertError(err);
						}

						callback(tags);
					});
				});
			},
			index: 1,
			replace: function (hashtag) {
				hashtag = $('<div/>').html(hashtag).text();
				return '#' + utils.slugify(hashtag, true) + ' ';
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
