import mongoose from 'mongoose';
import { config } from './config.js';
import { Bus } from './bus.js';
import { JobQueue } from './queue.js';
import { createApp } from './app.js';

await mongoose.connect(config.mongoUrl, { serverSelectionTimeoutMS: 8000 }).catch(error => {
  console.error(`Could not connect to MongoDB at ${config.mongoUrl}. Start MongoDB or set MONGO_URL in scripting/.env.\n${error.message}`);
  process.exit(1);
});
const bus = new Bus();
const queue = new JobQueue(bus);
await queue.recover();
const server = createApp(bus, queue).listen(config.port, () => {
  console.log(`YouTube Automation API on http://localhost:${config.port} (MongoDB ${mongoose.connection.name})`);
  queue.kick();
});

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    console.log('Stopping. A running video is stopped with its progress saved; resume it after restart.');
    server.close();
    await queue.shutdown();
    await mongoose.disconnect();
    process.exit(0);
  });
}
