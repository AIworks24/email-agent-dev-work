const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
    res.json({ message: 'Auth login route is working!' });
});

router.get('/debug', (req, res) => {
    res.json({ 
        message: 'Debug route working',
        env: process.env.NODE_ENV 
    });
});

module.exports = router;
