

'use strict';

var async = require('async'),

	db = require('../database'),
	user = require('../user'),
	posts = require('../posts'),
	utils = require('../../public/src/utils');



module.exports = function(Topics) {

	Topics.getTeasers = function(tids, uid, callback) {
		if (!Array.isArray(tids) || !tids.length) {
			return callback(null, []);
		}

		async.parallel({
			counts: function(next) {
				Topics.getTopicsFields(tids, ['postcount'], function(err, topics) {
					if (err) {
						return next(err);
					}
					topics = topics.map(function(topic) {
						return topic && (parseInt(topic.postcount, 10) || 0);
					});

					next(null, topics);
				});
			},
			pids: function(next) {
				async.map(tids, function(tid, next) {
					db.getSortedSetRevRange('tid:' + tid + ':posts', 0, 0, function(err, data) {
						next(err, Array.isArray(data) && data.length ? data[0] : null);
					});
				}, next);
			}
		}, function(err, results) {
			if (err) {
				return callback(err);
			}

			var postKeys = results.pids.filter(Boolean).map(function(pid) {
				return 'post:' + pid;
			});

			db.getObjectsFields(postKeys, ['pid', 'uid', 'timestamp', 'tid'], function(err, postData) {
				if (err) {
					return callback(err);
				}

				var uids = postData.map(function(post) {
					return post.uid;
				}).filter(function(uid, index, array) {
					return array.indexOf(uid) === index;
				});


				user.getMultipleUserFields(uids, ['uid', 'username', 'userslug', 'picture'], function(err, usersData) {
					if (err) {
						return callback(err);
					}

					var users = {};
					usersData.forEach(function(user) {
						users[user.uid] = user;
					});
					var tidToPost = {};
					postData.forEach(function(post) {
						post.user = users[post.uid];
						post.timestamp = utils.toISOString(post.timestamp);
						tidToPost[post.tid] = post;
					});

					var teasers = tids.map(function(tid, index) {
						if (tidToPost[tid]) {
							tidToPost[tid].index = results.counts[index];
						}
						return tidToPost[tid];
					});

					callback(null, teasers);
				});
			});
		});
	};

	Topics.getTeaser = function(tid, uid, callback) {
		Topics.getLatestUndeletedPid(tid, function(err, pid) {
			if (err || !pid) {
				return callback(err);
			}

			async.parallel({
				postData: function(next) {
					posts.getPostFields(pid, ['pid', 'uid', 'timestamp'], function(err, postData) {
						if (err) {
							return next(err);
						} else if(!postData || !utils.isNumber(postData.uid)) {
							return callback();
						}

						user.getUserFields(postData.uid, ['username', 'userslug', 'picture'], function(err, userData) {
							if (err) {
								return next(err);
							}
							postData.user = userData;
							next(null, postData);
						});
					});
				},
				postIndex: function(next) {
					posts.getPidIndex(pid, uid, next);
				}
			}, function(err, results) {
				if (err) {
					return callback(err);
				}

				results.postData.timestamp = utils.toISOString(results.postData.timestamp);
				results.postData.index = results.postIndex;

				callback(null, results.postData);
			});
		});
	};
};