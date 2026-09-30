# Using Browser Nodes

Browser nodes allow you to use a smartphone or a laptop as a wireless camera/microphone for the Spectra platform.

## The HTTPS Requirement

Modern browsers have strict security policies regarding `navigator.mediaDevices.getUserMedia()`. It is **blocked** on standard HTTP connections unless the host is `localhost`. 

If you are running Spectra on your laptop and trying to connect your phone via your local IP (e.g., `http://192.168.1.50:5173/node`), the browser will refuse to open the camera.

## How to Set Up HTTPS for Local Testing

To test browser nodes across your local network, you need a self-signed certificate.

### Step 1: Generate a Certificate
Run the included helper script from the project root:

```bash
chmod +x scripts/make_https.sh
./scripts/make_https.sh
```

This will create `config/certs/key.pem` and `config/certs/cert.pem`.

### Step 2: Start the Backend with SSL
Modify your startup command or `Makefile` target to pass the certificates to Uvicorn:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 \
    --ssl-keyfile config/certs/key.pem \
    --ssl-certfile config/certs/cert.pem
```

### Step 3: Configure Vite for HTTPS
In `frontend/vite.config.ts`, import the `vite-plugin-mkcert` or manually specify the basic HTTPS setup so the dev server uses SSL. (A quick hack is passing `--host` but Vite requires actual certs for HTTPS).

Alternatively, you can use a tunneling tool like **ngrok** or **Cloudflare Tunnels**, which provide a secure HTTPS endpoint automatically without needing local certificates.

```bash
# Example with ngrok
ngrok http 5173
```
Then open the `https://<random>.ngrok.io/node` link on your phone.

## Workflow

1. Go to the Spectra Dashboard (Overview page).
2. Click **ADD SOURCE**.
3. Select "Browser Node (Phone/Laptop)".
4. You will be given a **Token**.
5. On your phone, navigate to `https://<your-ip-or-tunnel>:5173/node`.
6. Enter the token and click **Start Streaming**.
7. The node will now appear as an active camera on the Live Ops page.
