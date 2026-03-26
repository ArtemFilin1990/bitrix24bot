// Middleware to check B24_APP_TOKEN
function checkToken(req, res, next) {
    if (!req.headers['b24_app_token']) {
        return res.status(403).send('Forbidden: Missing B24_APP_TOKEN');
    }
    next();
}

app.use('/imbot', checkToken);
