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

    if (process.env.NODE_ENV === 'development') {
        if (err.code === 11000) {
            const error = handleDuplicateErrorDB(err);
            return sendErrorDev(error, res);
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