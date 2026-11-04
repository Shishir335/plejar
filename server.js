const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: './config.env' });
dotenv.config(); // fallback to .env if config.env not deployed

if (!process.env.JWT_SECRET) {
  console.error('[CONFIG ERROR] JWT_SECRET is not set. Add it to config.env before starting the server.');
  process.exit(1);
}

const app = require('./app');
const realtime = require('./utils/realtime');
const { isCloudinaryConfigured } = require('./utils/cloudinary');
const { startReportScheduler } = require('./utils/reportScheduler');

// Handle uncaught exceptions gracefully
process.on('uncaughtException', err => {
  console.error('[UNCAUGHT EXCEPTION]', err.name, err.message);
  if (err.name !== 'MongoNetworkError' && err.name !== 'MongooseServerSelectionError') {
    // Keep alive in development if non-fatal
  }
});

// Detect whether server is started in dev / development mode
const isDev =
  process.env.NODE_ENV === 'development' ||
  process.argv.includes('dev') ||
  process.argv.includes('development') ||
  process.env.npm_lifecycle_event === 'dev' ||
  process.env.npm_lifecycle_event === 'start:dev' ||
  process.env.npm_lifecycle_event === 'start-dev';

if (isDev) {
  process.env.NODE_ENV = 'development';
}

// Configure MongoDB connection (Production vs Development DB)
let dbUri = '';
let dbLabel = '';

if (isDev) {
  dbUri =
    process.env.DATABASE_DEV ||
    (process.env.DATABASE
      ? process.env.DATABASE.replace('/plezar?', '/plezar_dev?').replace('/plezar', '/plezar_dev')
      : '') ||
    process.env.DATABASE_LOCAL ||
    '';
  dbLabel = 'plezar_dev [DEVELOPMENT DATABASE]';
} else {
  dbUri = process.env.DATABASE || '';
  dbLabel = 'plezar [PRODUCTION DATABASE]';
}

// Accept both our <PASSWORD> placeholder and Atlas's default <db_password>
if (process.env.DATABASE_PASSWORD) {
  dbUri = dbUri
    .replace('<PASSWORD>', encodeURIComponent(process.env.DATABASE_PASSWORD))
    .replace('<db_password>', encodeURIComponent(process.env.DATABASE_PASSWORD));
}

const isPlaceholderUri = !dbUri || dbUri.includes('<USERNAME>') || dbUri.includes('<NEW_CLUSTER_HOST>');

if (isPlaceholderUri) {
  console.log('------------------------------------------------------------');
  console.log('[MONGODB STATUS] Awaiting MongoDB cluster connection string.');
  console.log('[CONFIG] Set your cluster URI in config.env -> DATABASE');
  console.log('------------------------------------------------------------');
} else {
  console.log(`[MONGODB] Mode: ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
  console.log(`[MONGODB] Target: ${dbLabel}`);
  console.log('[MONGODB] Connecting to MongoDB cluster...');
  mongoose
    .connect(dbUri, {
      serverSelectionTimeoutMS: 5000
    })
    .then(async () => {
      console.log('============================================================');
      console.log(`[MONGODB SUCCESS] Connected to ${dbLabel} successfully!`);
      console.log('============================================================');
      startReportScheduler();
    })
    .catch(err => {
      console.warn('------------------------------------------------------------');
      console.warn('[MONGODB WARNING] Could not connect to configured MongoDB cluster:');
      console.warn(`>> ${err.message}`);
      console.warn('------------------------------------------------------------');
    });
}

const port = process.env.PORT || 3000;
const appName = process.env.APP_NAME || 'Plejar';

const server = app.listen(port, () => {
  console.log(`[SERVER] ${appName} server running on http://localhost:${port}`);
  console.log(`[REST API] Endpoints available at:`);
  console.log(`  - Health Check: http://localhost:${port}/api/v1/health`);
  console.log(`  - Users / Auth: http://localhost:${port}/api/v1/users`);
  console.log(`  - Newsletter:   http://localhost:${port}/api/v1/subscribers`);
  console.log(`  - Admin Panel:  http://localhost:${port}/admin`);
  console.log(`  - API Testing:  http://localhost:${port}/api-docs`);
});

// On a host like Render the disk is wiped on every deploy, taking local uploads with it
if (!isCloudinaryConfigured()) {
  console.warn(`[MEDIA] Cloudinary isn't set up: uploads are saved to this server's disk${process.env.NODE_ENV === 'production' ? ' and will be lost on the next deploy' : ''}.`);
}

// Live chat over Socket.IO on the same port (utils/realtime.js)
realtime.init(server);

process.on('unhandledRejection', err => {
  console.error('[UNHANDLED REJECTION]', err.name, err.message);
});
