# Automatización Financiera en Zoho

Aplicación externa para portal de pago express integrada con Zoho Books y Khipu.

## Stack

* Frontend: React + Vite + TypeScript
* Backend: Node.js + NestJS
* Base de datos: PostgreSQL
* ORM: Prisma
* Integraciones: Zoho Books API y Khipu API

## Estructura del proyecto

automatizacion-financiera-zoho/

* backend/
* frontend/
* docs/
* README.md

## Backend

Para iniciar el backend en desarrollo:

cd backend
npm install
npm run start:dev

API local:

http://localhost:3000/api

Rutas de prueba:

GET /api
GET /api/health
GET /api/health/db

## Frontend

Para iniciar el frontend en desarrollo:

cd frontend
npm install
npm run dev

Frontend local:

http://localhost:5173

## Variables de entorno

El proyecto usa archivos .env para credenciales y configuración local.

No se deben subir archivos .env reales al repositorio.

Se deben usar los archivos de ejemplo:

backend/.env.example
frontend/.env.example

Para crear los .env locales en Windows PowerShell:

Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env

## Seguridad básica

* Las credenciales reales de Zoho y Khipu deben ir solo en backend/.env.
* El frontend no debe contener credenciales privadas.
* El backend actúa como intermediario entre React, Zoho Books y Khipu.
* Los archivos .env están ignorados por Git.
