# Plezar // Full-Stack Node.js Application Starter

A clean, modern, and production-ready **Node.js, Express, and MongoDB** application starter template. Preconfigured with JWT authentication, role-based access control (RBAC), enterprise security middlewares, transactional email dispatcher, and a user administration dashboard.

---

## 🌟 Core Architecture & Features

### 1. Robust Authentication & Session Management
- **JWT & HTTP-Only Cookies**: Secure authentication flow with cross-site request forgery (CSRF) protection and XSS mitigation.
- **Bcrypt Password Encryption**: Industry standard 12-round salted hashing.
- **Password Reset Flow**: Crypto-generated, time-limited SHA-256 tokens sent via automated email links.
- **Google OAuth 2.0**: Built-in support for Google Identity Services.

### 2. Multi-Tier Role-Based Access Control (RBAC)
- **Roles**: `admin`, `manager`, `user`.
- **Privilege Protection**: Role escalation prevention (e.g., self-demotion prevention, managers cannot promote to admin).
- **Route Guards**: Express middlewares (`protect`, `restrictTo`).

### 3. Enterprise-Grade Security Suite
- **Helmet**: Security HTTP headers with popup authorization policies.
- **Rate Limiting**: Granular rate limits (1000 requests/hour general, 15 attempts/15 minutes on auth endpoints).
- **Data Sanitization**: `express-mongo-sanitize` to block NoSQL injection attacks, `xss-clean` for cross-site scripting prevention, and `hpp` for HTTP Parameter Pollution defense.
- **CORS**: Credential-ready Cross-Origin Resource Sharing.

### 4. Database & Query Helpers
- **Mongoose ODM**: Structured schemas with automatic timestamping and indexing.
- **API Features (`utils/apiFeatures.js`)**: Reusable query chain for filtering, field limiting, sorting, and pagination.
- **Handler Factory (`controllers/handlerFactory.js`)**: Generic CRUD handlers for standard endpoints.

### 5. Media & Email Services
- **Cloudinary Integration**: Image uploads and media assets.
- **Pug Email Engine**: Nodemailer dispatcher with modern Pug templates for welcome and password reset.

### 6. Administration Console
- **User Directory**: View all registered users, filter by role, search by name/email.
- **Account Actions**: Assign roles, reset passwords, or delete accounts.
- **Newsletter Leads**: Manage newsletter subscribers and export to CSV.
- **System Diagnostics**: Inspect server uptime, environment variables, and endpoint status.

---

## 🛠️ Technology Stack

- **Runtime**: Node.js (>= 18.0.0)
- **Framework**: Express.js 4.x
- **Database**: MongoDB via Mongoose 8.x
- **Security**: Helmet, express-rate-limit, express-mongo-sanitize, xss-clean, hpp, cors, cookie-parser
- **Email**: Nodemailer, Pug, html-to-text
- **File & Media**: Multer, Sharp, Cloudinary

---

## 📁 Project Directory Structure

```
plezar/
├── controllers/          # Request handlers & business logic
│   ├── authController.js       # Signup, login, logout, password recovery
│   ├── userController.js       # User CRUD, role management, photo upload
│   ├── subscriberController.js # Newsletter subscription & CSV export
│   ├── errorController.js      # Global centralized error handler
│   └── handlerFactory.js       # Reusable generic CRUD controller factory
├── models/               # Mongoose schemas
│   ├── userModel.js            # User accounts, authProvider, roles
│   └── subscriberModel.js      # Newsletter subscribers
├── routes/               # Express router endpoints
│   ├── userRoutes.js           # Auth & user management endpoints
│   └── subscriberRoutes.js     # Newsletter subscription endpoints
├── utils/                # Reusable helper utilities
│   ├── apiFeatures.js          # Query filtering, sorting, pagination
│   ├── appError.js             # Custom operational error class
│   ├── catchAsync.js           # Async route wrapper
│   ├── cloudinary.js           # Media storage service
│   └── email.js                # Transactional email sender
├── views/                # Email Pug templates
│   └── email/
│       ├── _style.pug
│       ├── baseEmail.pug
│       ├── welcome.pug
│       └── passwordReset.pug
├── public/               # Frontend static assets & dashboards
│   ├── css/
│   │   ├── main.css            # Core design system stylesheet
│   │   └── admin.css           # Administration console stylesheet
│   ├── js/
│   │   ├── app.js              # Frontend auth state & API explorer
│   │   └── admin.js            # Admin user management & subscriber controller
│   ├── index.html              # Main application landing & API explorer
│   ├── admin.html              # User & role administration console
│   └── reset-password.html     # Password recovery interface
├── config.env            # Environment configuration
├── server.js             # Server entry point & MongoDB connection
├── app.js                # Express app initialization & middleware stack
└── package.json          # Dependencies and scripts
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `config.env` and update your values:
```bash
cp .env.example config.env
```

### 3. Run Development Server
```bash
npm run dev
```

### 4. Run Production Server
```bash
npm start
```

Your server will be running on `http://localhost:3000` with:
- **Main Starter Page**: [http://localhost:3000/](http://localhost:3000/)
- **Admin Console**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Health Check API**: [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health)
# plezar
