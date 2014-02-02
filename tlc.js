var cheerio = require('cheerio');
var request = require('request');
var crypto = require('crypto');
var _ = require('underscore');

var dept_map = {
	'61405' : "Front of Precinct",
   	'61100' : "Home & Mobile Ent.",
    '50800' : "Back of Precinct",
    '51600' : "GSI",
    '51700' : "Double Agent",
    '60020' : "Management",
    '60025' : "Sales Support Leaders",
    '60030' : "Admin",
    '60040' : "Gaming",
    '60050' : "Merch",
    '60060' : "Sales Support",
    '60080' : "Asset Protection",
    '61101' : "Lifestyles",
    '61410' : "Multi-Channel",
    '61420' : "Appliances",
    '61430' : "Computers",
    '61435' : "Home Leaders",
    '61450' : "Mobile Electronics",
    '61460' : "Mobile",
    '61470' : "Home Theater",
    '61480' : "Portable Electronics",
    '61530' : "Tablets",
    '61540' : "Connectivity Leaders"
};	

var active_session_ids = {};

function tlc_request(method, path, session_id, params, cb) {
	var opts = {
		rejectUnauthorized: false, 
		uri: 'https://mytlc.bestbuy.com' + path,
		method: method
	};
	if(session_id)
		opts.headers = { 'Cookie' : 'JSESSIONID=' + session_id };
	if(params)
		opts.form = params;

	request(opts, cb);
}

function end_json(status, res, obj) {
	var ret = JSON.stringify(obj, null, '\t');
	res.writeHead(status, {
		'Access-Control-Allow-Origin' : '*',
		'Content-Length' : ret.length,
		'Content-Type' : 'application/json'
	});
	res.end(ret);
}

var tlc_post = function(path, params, session_id, cb) {
	request({method: 'POST', headers: { 'Cookie' : 'JSESSIONID=' + session_id }, form: params, rejectUnauthorized: false, uri: 'https://mytlc.bestbuy.com' + path }, cb);
}

exports.flush = function() {
	active_session_ids = {};
}

function shifts_from_str_day(str, day) {
	var splits = str.split('\n\n');
	if(splits.length > 1) { 
		return null;
	}

	var time = /(\d{2}:\d{2})\s+([AP]M) - (\d{2}:\d{2})\s+([AP]M)/.exec(str);
	var info = /(\d+)-DEPT(\d+)/.exec(str);

	var store = parseInt(info[1]);
	var dept = dept_map[info[2]];

	var shifts = [];
	for(var i=1, x=1;i<info.length;i+=4,x+=2) {
		var start = time[i] + ' ' + time[i+1];
		var end = time[i+2] + ' ' + time[i+3];

		var shift = {};
		shift.start = start;
		shift.end = end;
		shift.day = day;

		shift.store = parseInt(info[x]);
		shift.department = dept_map[info[x+1]];

		shifts.push(shift);
	}

	return shifts;
}

exports.login = function(employee_id, password, res) {
	if(active_session_ids[employee_id]) {
		if(active_session_ids[employee_id].password == crypto.createHash('md5').update(password).digest('hex')) {
			end_json(200, res, _.omit(active_session_ids[employee_id], 'password'));
		} else {
			end_json(401, res, {
				error: 'Invalid password'
			});
		}

		return;
	}

	tlc_request('GET', '/etm', null, null, function (error, response, body) {
		if(!error && response.statusCode == 200) {
			var cookies = response.headers['set-cookie'];
			var regex = /JSESSIONID=([0-9a-zA-_Z:-]+)/;
			var match = regex.exec(cookies[0])[1];
			var sid = match;

			var $ = cheerio.load(body);
			var url_login_token = $('[name=url_login_token]').val();
			var wbat = $('[name=wbat]').val();

			if(!match) {
				end_json(417, res, { 'error' : 'Could not parse interal session identifier' });
				return;
			}
			if(!url_login_token || !wbat) {
				end_json(417, res, { 'error' : 'Could not parse TLC login parameters' });
				return;
			}

			var login_params = {
				'url_login_token' : url_login_token,
				'wbat'			  : wbat,
				'client' 		  : 'DEFAULT',
				'localeSelected'  : 'false',
				'login'			  : employee_id,
				'password'		  : password,
				'pageAction'	  : 'login',
				'wbXpos'		  : '0',
				'wbYpos'		  : '0'
			};

			tlc_request('POST', '/etm/login.jsp', match, login_params, function (error, response, body) {
				if(!error && response.statusCode == 200) {
					var $ = cheerio.load(body);

					var user = $('.loggedInUser').text();
					if(!user.length) {
						var ldap_str = $('font[color=red]').text();
						var match = /\[LDAP: error code (\d+)/.exec(ldap_str)[1];

						if(match.length >= 2) {
							var m = parseInt(match);

							if(m == 32) {
								end_json(401, res, {
									error: 'Invalid username'
								});
								return;
							} else if(m == 49) {
								end_json(401, res, {
									error: 'Invalid password'
								});
							}
						}

						end_json(417, res, {error : 'Could not log in to TLC' });

						return;
					}

					var result = /(\w+),\s+(\w+)/.exec(user);
					var first = result[2];
					var last = result[1];

					var full = first + ' ' + last;

					active_session_ids[employee_id] = {
						name: full,
						'session_id': sid
					};

					end_json(200, res, active_session_ids[employee_id]);

					setTimeout(function () {
						delete active_session_ids[employee_id];
					}, 1000 * 60 * 20);

					var hash = crypto.createHash('md5').update(password).digest('hex');
					active_session_ids[employee_id].password = hash;
				} else {
					end_json(417, res, { 'error' : 'Could not contact TLC' });
				}
			});
		} else {
			end_json(417, res, { 'error' : 'Could not contact TLC' });
		}
	});
}

exports.get_schedule = function (session_id, res) {
	tlc_request('GET', '/etm/time/timesheet/etmTnsMonth.jsp', session_id, null, function (error, response, body) {
		if(!error && response.statusCode == 200) {
			var $ = cheerio.load(body);
			var valid = $('.calWeekDayHeader');

			if(!valid.length) {
				if(body.indexOf('top.location = "/etm/login.jsp"') > 0) {
					delete active_session_ids[employee_id];

					end_json(400, res, {
						error: 'Session expired'
					});
					return;
				}

				end_json(400, res, {
					error: 'Problem fetching schedule'
				});
				return;
			}

			var resret = {};

			var future = [], past = [], current = [];
			$('.calendarCellRegularFuture[valign]').each(function (index) {
				var day_ = parseInt($(this).find('.calendarDateNormal').text());
				var body = $(this).find('.calendarCellRegularFuture.etmNoBorder').text();

				body = body.trim();

				var shifts = shifts_from_str_day(body, day_);
				_.each(shifts, function(_s) { 
					future.push(_s) ;
				});
			});

			$('.calendarCellRegularCurrent[valign]').each(function (index) {
				var day_ = parseInt($(this).find('.calendarDateCurrent').text());
				var body = $(this).find('.calendarCellRegularCurrent.etmNoBorder').text();

				body = body.trim();

				if(body == "OFF") return;
				var shifts = shifts_from_str_day(body, day_);
				_.each(shifts, function(_s) { current.push(_s) });

			});

			$('.calendarCellRegularPast[valign]').each(function (index) {
				var day_ = parseInt($(this).find('.calendarDateNormal').text());
				var body = $(this).find('.calendarCellRegularPast.etmNoBorder').text();

				body = body.trim();
				if(body == "OFF") return;
				var shifts = shifts_from_str_day(body, day_);
				_.each(shifts, function(_s) { past.push(_s) });
			});

			resret.current = current;
			resret.past = past;
			resret.future = future;

			end_json(200, res, resret);
		}
	});
}
