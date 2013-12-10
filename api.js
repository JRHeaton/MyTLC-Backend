var express = require('express');
var api = express();

var tlc = require('./tlc.js');

api.use(express.json());
api.use(express.urlencoded());

api.post('/login', function (req, res) {
	var employee_id = req.body.employee_id;
	var password = req.body.password;

	if(employee_id == undefined || password == undefined) {
		res.status(400);
		res.end(JSON.stringify({ 'error' : 'Must provide employee_id and password parameters'}));

		return;
	}

	tlc.login(employee_id, password, res);
});

api.get('/schedule', function (req, res) {
	var session_id = req.query.session_id;
	if(!session_id) {
		res.status(400);
		res.end(JSON.stringify({ error: 'Must provide session_id paramter' }));
	}

	tlc.get_schedule(session_id, res);
});

api.get('/flush', function (req, res) {
	tlc.flush();
	res.status(200);
	res.end();
});

api.listen(2220);
