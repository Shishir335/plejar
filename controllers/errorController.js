const AppError = require("../utils/appError");

const handleCastErrorDB = err => {
    const message = `Invalid ${err.path} : ${err.value}`;
    return new AppError(message, 400);
}

const handleDuplicateErrorDB = err => {
    const key = err.keyValue ? Object.keys(err.keyValue)[0] : '';
    const value = err.keyValue ? err.keyValue[key] : '';
    if (key === 'email' || (err.message && err.message.includes('email'))) {
        return new AppError('An account with this email already exists. Please log in or try another email.', 400);
    }
    const message = `Duplicate field value: ${value}. Please use another value`;
    return new AppError(message, 400);
}

const handleValidationErrorDB = err => {
    const errors = Object.values(err.errors).map(el => el.message);
    const message = `Invalid input data. ${errors.join('. ')}`;
    return new AppError(message, 400);
}

const handleMulterError = err => {
    const messages = {
        LIMIT_FILE_SIZE: 'That file is too large. Upload files of 5 MB or less.',
        LIMIT_FILE_COUNT: 'Too many files. Remove some and try again.',
        LIMIT_UNEXPECTED_FILE: 'Unexpected file field or too many files.'
    };
    return new AppError(messages[err.code] || 'The upload could not be processed.', 400);
}

const handleJWTError = () => new AppError('Invalid token.', 401);

const handleJWTExpireError = () => new AppError('Token expired', 401);

const sendErrorDev = (err, res) => {
    res.status(err.statusCode).json({
        status: err.status,
        error: err,
        message: err.message,
        stack: err.stack
    });
}

const sendErrorProd = (err, res) => {
    if (err.isOperational) {
        res.status(err.statusCode).json({
            status: err.status,
            message: err.message
        });
    } else {
        res.status(500).json({
            status: 'error',
            message: 'Something went wrong'
        })
    }
}


module.exports = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    if (err.name === 'MulterError') {
        err = handleMulterError(err);
    }

    if (process.env.NODE_ENV === 'development') {
        if (err.code === 11000) {
            const error = handleDuplicateErrorDB(err);
            return sendErrorDev(error, res);
        }
        // Same status codes as production, but keep the original stack for debugging
        if (err.name === 'ValidationError' || err.name === 'CastError') {
            const mapped = err.name === 'ValidationError' ? handleValidationErrorDB(err) : handleCastErrorDB(err);
            mapped.stack = err.stack;
            return sendErrorDev(mapped, res);
        }
        sendErrorDev(err, res);
    } else {
        let error = { ...err };
        error.message = err.message;
        error.name = err.name;
        if (err.isOperational) error.isOperational = true;
        if (err.statusCode) error.statusCode = err.statusCode;
        if (err.status) error.status = err.status;

        if (err.name === 'CastError')
            error = handleCastErrorDB(error);
        if (err.code === 11000)
            error = handleDuplicateErrorDB(error);
        if (err.name === 'ValidationError')
            error = handleValidationErrorDB(error);
        if (err.name === 'JsonWebTokenError')
            error = handleJWTError();
        if (err.name === 'TokenExpiredError')
            error = handleJWTExpireError();

        sendErrorProd(error, res);
    }
}