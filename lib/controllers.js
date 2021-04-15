'use strict';

const Controllers = {};

Controllers.renderAdminPage = function (req, res/* , next */) {
	res.render('admin/plugins/hashtags', {});
};

module.exports = Controllers;
