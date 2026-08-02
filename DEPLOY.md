# Despliegue en VPS con Docker + Coolify

Esta guía explica cómo desplegar la aplicación AI Chat en un servidor VPS usando [Coolify](https://coolify.io), una plataforma de despliegue auto-hospedada alternativa a Heroku/Railway.

## Requisitos previos

- Un **VPS** con Ubuntu 20.04+ (o similar) con al menos **2 GB de RAM**
- Docker y Docker Compose instalados en el VPS
- Una cuenta de [Coolify](https://coolify.io) o Coolify instalado en tu propio servidor
- El repositorio de GitHub: `github.com/katobesto/aiPersonChat`

---

## Paso 1: Instalar Coolify (si no lo tienes ya)

Si aún no tienes Coolify, instálalo en el VPS con un solo comando:

```bash
# Conéctate al VPS por SSH
ssh root@tu-servidor-ip

# Instala Coolify automáticamente
curl -fsSL https://get.coollabs.io/coolify/install.sh | bash
```

La instalación instalará Docker, Docker Compose y configurará toda la infraestructura de Coolify. Al finalizar tendrás acceso al dashboard en `https://<tu-servidor-ip>`.

---

## Paso 2: Conectar tu servidor a Coolify

1. Abre el dashboard de Coolify
2. Ve a **Servers** → **Add Server**
3. Si Coolify está instalado en el mismo servidor, usa la conexión local (localhost)
4. Si usas Coolify cloud, introduce la IP del VPS y las credenciales SSH

---

## Paso 3: Conectar tu cuenta de GitHub

1. En Coolify ve a **Settings** → **Git Providers**
2. Selecciona **GitHub** y conecta tu cuenta (o usa un token personal)
3. Asegúrate de que el repositorio `katobesto/aiPersonChat` es visible

---

## Paso 4: Crear el recurso de despliegue

1. Ve a **Projects** → crea o selecciona un proyecto
2. Haz clic en **Add Resource** → **Application**
3. Selecciona tu repositorio GitHub y la rama `main`
4. En **Build Pack**, Coolify detectará automáticamente el archivo `docker-compose.yml`. Si no, selecciona manualmente **Docker Compose Build Pack**.
5. Haz clic en **Deploy**

---

## Paso 5: Configurar variables de entorno

Coolify leerá el docker-compose y te pedirá las variables que faltan:

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `JWT_SECRET` | Secret para firmar los tokens JWT. **Obligatorio**. | Cualquier string aleatorio largo |

Puedes generar uno con:
```bash
openssl rand -hex 32
```

---

## Paso 6: Asignar un dominio

1. En la página del recurso en Coolify, ve a la sección **Domains**
2. Añade el dominio deseado, ej: `chat.tudominio.com`
3. Configura el DNS apuntando al IP de tu VPS (registro A)
4. Coolify generará automáticamente un certificado SSL con Let's Encrypt

---

## Paso 7: Desplegar

Haz clic en **Deploy** y observa los logs. Los primeros despliegues tardan más porque deben construir las imágenes Docker.

### Estructura de servicios

| Servicio | Puerto interno | Descripción |
|----------|---------------|-------------|
| `frontend` | 80 | Nginx sirve la app Vite + proxy /api al backend |
| `backend` | 3001 | Servidor Express con API y base de datos SQLite |

El frontend actúa como punto de entrada: el usuario accede a `https://chat.tudominio.com` y todas las peticiones `/api/*` se enrutan automáticamente al backend.

---

## Datos persistentes

La base de datos SQLite (`backend/data/ai-chat.db`) se almacena en un **volumen Docker** que persiste entre redesplesgos y actualizaciones. No perderás datos al actualizar la app.

---

## Redeploy / Actualizar

Cada vez que hagas push a `main` en GitHub:
- Si has activado **Auto Deploy**, Coolify reconstruirá y desplegará automáticamente
- Si no, ve a la página del recurso y haz clic en **Redeploy**

---

## Logs y monitorización

Coolify incluye un visor de logs integrado. Desde el dashboard puedes ver los logs en tiempo real de cada servicio (`frontend` y `backend`).

---

## Troubleshooting

### La app no se conecta al backend
Verifica que el contenedor frontend puede alcanzar el backend:
```bash
docker exec -it <frontend-container> wget -qO- http://backend:3001/health
```

### Error de JWT_SECRET
Asegúrate de haber configurado la variable `JWT_SECRET` en Coolify antes de desplegar. Es obligatoria (marcada con `:?`).

### SSL no funciona
Coolify configura automáticamente Let's Encrypt. Asegúrate de que el DNS apunta correctamente a tu servidor antes de activar SSL.

---

## Comandos útiles

```bash
# Ver logs del backend en tiempo real desde Coolify UI o:
docker compose -f docker-compose.yml logs -f backend

# Acceder al shell del backend para debug:
docker exec -it <backend-container> sh

# Reiniciar un servicio específico:
docker compose restart backend
```
