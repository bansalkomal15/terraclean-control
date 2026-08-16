'use strict';
/* Local and Docker entry point. On Vercel, api/index.js is used instead. */
const app = require('./server/app');
const store = require('./lib/store');
const mailer = require('./lib/mailer');

const PORT = +(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log('\nTerra Clean control tower');
  console.log('  http://localhost:' + PORT);
  console.log('  storage: ' + store.driverKind());
  console.log('  sign in as ' + (process.env.ADMIN_EMAIL || 'bansalkomal15@gmail.com'));
  if (!mailer.configured) console.log('  mail is not configured — sign-in codes will print here\n');
});
