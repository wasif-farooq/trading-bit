const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const logDir = path.resolve(process.cwd(), 'logs');

if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, { recursive: true });
}

const logLevel = process.env.LOG_LEVEL || 'info';

const logFormat = winston.format.combine(
	winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
	winston.format.errors({ stack: true }),
	winston.format.splat(),
	winston.format.json()
);

const consoleFormat = winston.format.combine(
	winston.format.colorize(),
	winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
	winston.format.printf(({ timestamp, level, message, ...meta }) => {
		let msg = `${timestamp} [${level}]: ${message}`;
		if (Object.keys(meta).length > 0 && meta.stack) {
			msg += `\n${meta.stack}`;
		} else if (Object.keys(meta).length > 0) {
			msg += ` ${JSON.stringify(meta)}`;
		}
		return msg;
	})
);

const logger = winston.createLogger({
	level: logLevel,
	levels: winston.config.npm.levels,
	format: logFormat,
	defaultMeta: { service: 'trading-bot' },
	transports: [
		new winston.transports.Console({
			format: consoleFormat,
			handleExceptions: true,
			handleRejections: true
		}),
		new DailyRotateFile({
			filename: path.join(logDir, 'app-%DATE%.log'),
			datePattern: 'YYYY-MM-DD',
			zippedArchive: true,
			maxSize: '20m',
			maxFiles: '14d',
			format: logFormat,
			handleExceptions: true,
			handleRejections: true
		}),
		new DailyRotateFile({
			filename: path.join(logDir, 'error-%DATE%.log'),
			datePattern: 'YYYY-MM-DD',
			level: 'error',
			zippedArchive: true,
			maxSize: '20m',
			maxFiles: '14d',
			format: logFormat,
			handleExceptions: true,
			handleRejections: true
		})
	]
});

logger.trace = logger.silly;

module.exports = logger;

