/* Vercel serverless entry point. Every /api/* request runs this function;
   everything in public/ is served by Vercel's CDN without touching Node. */
module.exports = require('../server/app');
