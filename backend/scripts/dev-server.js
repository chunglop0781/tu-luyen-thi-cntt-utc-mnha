'use strict';
// Chạy thử cục bộ: node scripts/dev-server.js  (cần .env; đặt ALLOW_LOCALHOST=true để frontend localhost gọi được)
require('./env')();
const http = require('http');
const handler = require('../api/index.js');
const port = Number(process.env.PORT || 3000);
http.createServer(handler).listen(port, () => console.log(`API chạy tại http://localhost:${port}/api/health`));
