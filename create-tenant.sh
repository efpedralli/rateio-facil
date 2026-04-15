#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/nyaia/apps/rateio-facil"
UPLOAD_BASE="/home/nyaia/uploads"
LOG_BASE="/home/nyaia/logs"
CONTROL_DB="nyaia_control"
PG_HOST="127.0.0.1"
PG_PORT="5432"
HESTIA_USER="nyaia"
DOMAIN_SUFFIX="nya.ia.br"
NEXT_PORT="3000"

SLUG="${1:-}"
COMPANY_NAME="${2:-}"

if [ -z "$SLUG" ] || [ -z "$COMPANY_NAME" ]; then
  echo "Uso: ./create-tenant.sh <slug> <company_name>"
  exit 1
fi

HOST="${SLUG}.${DOMAIN_SUFFIX}"
DB_NAME="rateio_${SLUG}"
DB_USER="tenant_${SLUG}"
UPLOAD_DIR="${UPLOAD_BASE}/${SLUG}"
LOG_DIR="${LOG_BASE}/${SLUG}"
WEB_CONF_DIR="/home/${HESTIA_USER}/conf/web/${HOST}"

echo "======================================="
echo "Tenant: $SLUG"
echo "Empresa: $COMPANY_NAME"
echo "Host: $HOST"
echo "DB_NAME: $DB_NAME"
echo "DB_USER: $DB_USER"
echo "======================================="

run_psql() {
  sudo -u postgres psql "$@"
}

tenant_row="$(run_psql -d "$CONTROL_DB" -t -A -F '|' -c "SELECT id, db_password FROM tenants WHERE slug = '$SLUG' LIMIT 1;")"

if [ -n "$tenant_row" ]; then
  TENANT_ID="$(echo "$tenant_row" | cut -d'|' -f1)"
  DB_PASS="$(echo "$tenant_row" | cut -d'|' -f2)"
  echo "Tenant já existe em ${CONTROL_DB} (id=${TENANT_ID}). Reaproveitando senha salva."
else
  DB_PASS="$(openssl rand -hex 16)"
  echo "Tenant ainda não existe em ${CONTROL_DB}. Gerando nova senha."
fi

user_exists="$(run_psql -t -A -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER';")"
if [ "$user_exists" != "1" ]; then
  echo "==> Criando usuário Postgres..."
  run_psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
else
  echo "==> Usuário Postgres já existe."
fi

db_exists="$(run_psql -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';")"
if [ "$db_exists" != "1" ]; then
  echo "==> Criando banco..."
  run_psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
else
  echo "==> Banco já existe."
fi

echo "==> Garantindo privilégios..."
run_psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';"
run_psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

echo "==> Criando diretórios..."
mkdir -p "$UPLOAD_DIR" "$LOG_DIR"
chown -R "$HESTIA_USER:$HESTIA_USER" "$UPLOAD_DIR" "$LOG_DIR"

tenant_exists="$(run_psql -d "$CONTROL_DB" -t -A -c "SELECT 1 FROM tenants WHERE slug = '$SLUG';")"
if [ "$tenant_exists" = "1" ]; then
  echo "==> Atualizando tenant no ${CONTROL_DB}..."
  run_psql -d "$CONTROL_DB" -c "
    UPDATE tenants
    SET
      host = '$HOST',
      company_name = '$COMPANY_NAME',
      db_name = '$DB_NAME',
      db_user = '$DB_USER',
      db_password = '$DB_PASS',
      db_host = '$PG_HOST',
      db_port = $PG_PORT,
      upload_dir = '$UPLOAD_DIR',
      log_dir = '$LOG_DIR',
      active = true,
      updated_at = NOW()
    WHERE slug = '$SLUG';
  "
else
  echo "==> Inserindo tenant no ${CONTROL_DB}..."
  run_psql -d "$CONTROL_DB" -c "
    INSERT INTO tenants (
      slug,
      host,
      company_name,
      db_name,
      db_user,
      db_password,
      db_host,
      db_port,
      upload_dir,
      log_dir,
      active,
      created_at,
      updated_at
    )
    VALUES (
      '$SLUG',
      '$HOST',
      '$COMPANY_NAME',
      '$DB_NAME',
      '$DB_USER',
      '$DB_PASS',
      '$PG_HOST',
      $PG_PORT,
      '$UPLOAD_DIR',
      '$LOG_DIR',
      true,
      NOW(),
      NOW()
    );
  "
fi

echo "==> Rodando migrations..."
cd "$APP_DIR"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${PG_HOST}:${PG_PORT}/${DB_NAME}" npx prisma migrate deploy

domain_exists="$(v-list-web-domains "$HESTIA_USER" plain | awk '{print $1}' | grep -Fx "$HOST" || true)"
if [ -z "$domain_exists" ]; then
  echo "==> Criando domínio no Hestia..."
  v-add-web-domain "$HESTIA_USER" "$HOST"
else
  echo "==> Domínio já existe no Hestia."
fi

echo "==> Preparando includes custom do Hestia..."
mkdir -p "$WEB_CONF_DIR"

CUSTOM_HTTP="${WEB_CONF_DIR}/nginx.conf_custom"
CUSTOM_HTTPS="${WEB_CONF_DIR}/nginx.ssl.conf_custom"

cat > "$CUSTOM_HTTP" <<EOF
# Custom include for ${HOST}
proxy_set_header Host \$host;
proxy_set_header X-Forwarded-Host \$host;
proxy_set_header X-Forwarded-Proto \$scheme;
proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
EOF

cat > "$CUSTOM_HTTPS" <<EOF
# Custom include for ${HOST}
proxy_set_header Host \$host;
proxy_set_header X-Forwarded-Host \$host;
proxy_set_header X-Forwarded-Proto \$scheme;
proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
EOF

echo "==> Rebuild do domínio no Hestia..."
v-rebuild-web-domain "$HESTIA_USER" "$HOST"

echo "==> Testando Nginx..."
nginx -t
systemctl reload nginx

echo "==> Verificando DNS..."
resolved_ip="$(dig +short "$HOST" | tail -n1 || true)"
server_ip="$(hostname -I | awk '{print $1}')"

if [ -n "$resolved_ip" ] && [ "$resolved_ip" = "$server_ip" ]; then
  echo "==> Tentando ativar SSL..."
  if v-add-letsencrypt-domain "$HESTIA_USER" "$HOST"; then
    echo "SSL emitido com sucesso."
    nginx -t
    systemctl reload nginx
  else
    echo "SSL não emitido agora. Rode depois:"
    echo "v-add-letsencrypt-domain $HESTIA_USER $HOST"
  fi
else
  echo "DNS ainda não aponta corretamente para este servidor."
  echo "Resolvido: ${resolved_ip:-<vazio>}"
  echo "Servidor:  $server_ip"
  echo "Quando propagar, rode:"
  echo "v-add-letsencrypt-domain $HESTIA_USER $HOST"
fi

echo "======================================="
echo "TENANT PRONTO"
echo "Host: $HOST"
echo "DB_NAME: $DB_NAME"
echo "DB_USER: $DB_USER"
echo "DB_PASS: $DB_PASS"
echo "Upload dir: $UPLOAD_DIR"
echo "Log dir: $LOG_DIR"
echo "======================================="
