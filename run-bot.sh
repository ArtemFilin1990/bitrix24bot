#!/bin/bash
# Скрипт для запуска бота Bitrix24 на Cloudflare Workers
# Usage: ./run-bot.sh [deploy|seed|register|full]

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для вывода сообщений
log_info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Проверка наличия wrangler
if ! command -v wrangler &> /dev/null; then
    log_error "Wrangler не установлен"
    log_info "Установка wrangler..."
    npm install -g wrangler@4.76.0
    log_success "Wrangler установлен"
fi

# Проверка авторизации в Cloudflare
check_auth() {
    log_info "Проверка авторизации в Cloudflare..."
    if ! wrangler whoami &> /dev/null; then
        log_warning "Вы не авторизованы в Cloudflare"
        log_info "Для авторизации требуются следующие секреты в GitHub Actions:"
        echo "  - CLOUDFLARE_API_TOKEN"
        echo "  - CLOUDFLARE_ACCOUNT_ID"
        log_info "Для локальной разработки выполните: wrangler login"
        return 1
    fi
    log_success "Авторизация успешна"
    return 0
}

# Деплой воркера
deploy_worker() {
    log_info "Деплой Worker на Cloudflare..."
    wrangler deploy
    log_success "Worker успешно задеплоен"
}

# Применение схемы базы данных
apply_schema() {
    log_info "Применение схемы базы данных..."
    wrangler d1 execute bearings-catalog --file schema.sql --remote
    log_success "Схема базы данных применена"
}

# Загрузка данных о подшипниках
seed_bearings() {
    log_info "Клонирование репозитория BearingsInfo..."
    if [ -d "/tmp/BearingsInfo" ]; then
        rm -rf /tmp/BearingsInfo
    fi
    git clone --depth=1 https://github.com/ArtemFilin1990/BearingsInfo.git /tmp/BearingsInfo
    log_success "Репозиторий BearingsInfo склонирован"

    log_info "Генерация SQL для подшипников..."
    SNAPSHOT=$(git -C /tmp/BearingsInfo rev-parse HEAD)
    python3 scripts/build_bearings_seed.py \
        --source-dir /tmp/BearingsInfo \
        --output /tmp/bearings.seed.sql \
        --source-repo ArtemFilin1990/BearingsInfo \
        --source-snapshot "$SNAPSHOT"
    log_success "SQL для подшипников сгенерирован"

    log_info "Загрузка данных о подшипниках в D1..."
    wrangler d1 execute bearings-catalog --file /tmp/bearings.seed.sql --remote
    log_success "Данные о подшипниках загружены"
}

# Загрузка базы знаний
seed_knowledge_base() {
    log_info "Клонирование репозитория knowledge-base..."
    if [ -d "/tmp/knowledge-base" ]; then
        rm -rf /tmp/knowledge-base
    fi
    git clone --depth=1 https://github.com/ArtemFilin1990/knowledge-base.git /tmp/knowledge-base
    log_success "Репозиторий knowledge-base склонирован"

    log_info "Генерация SQL для базы знаний..."
    SNAPSHOT=$(git -C /tmp/knowledge-base rev-parse HEAD)
    python3 scripts/build_kb_seed.py \
        --source-dir /tmp/knowledge-base \
        --output /tmp/kb.seed.sql \
        --source-repo ArtemFilin1990/knowledge-base \
        --source-snapshot "$SNAPSHOT"
    log_success "SQL для базы знаний сгенерирован"

    log_info "Загрузка базы знаний в D1..."
    wrangler d1 execute bearings-catalog --file /tmp/kb.seed.sql --remote
    log_success "База знаний загружена"
}

# Регистрация бота в Bitrix24
register_bot() {
    log_info "Регистрация бота в Bitrix24..."

    # Получение URL воркера
    if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
        log_error "CLOUDFLARE_ACCOUNT_ID не установлен"
        return 1
    fi

    if [ -z "$IMPORT_SECRET" ]; then
        log_error "IMPORT_SECRET не установлен"
        return 1
    fi

    SUBDOMAIN=$(curl -sf \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['subdomain'])")

    WORKER_URL="https://bitrix24bot.${SUBDOMAIN}.workers.dev"
    log_info "URL воркера: ${WORKER_URL}"

    RESULT=$(curl -sf "${WORKER_URL}/register?secret=${IMPORT_SECRET}" || echo '{"error":"curl failed"}')
    echo "$RESULT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('ok'):
    print('✓ Бот зарегистрирован! BOT_ID =', d.get('bot_id'))
elif 'error' in d:
    print('✗ Ошибка:', d['error'])
    exit(1)
"
    log_success "Бот успешно зарегистрирован"
}

# Основная логика
main() {
    case "${1:-full}" in
        deploy)
            log_info "=== ДЕПЛОЙ WORKER ==="
            deploy_worker
            ;;
        seed)
            log_info "=== ЗАГРУЗКА ДАННЫХ ==="
            apply_schema
            seed_bearings
            seed_knowledge_base
            ;;
        register)
            log_info "=== РЕГИСТРАЦИЯ БОТА ==="
            register_bot
            ;;
        full)
            log_info "=== ПОЛНАЯ УСТАНОВКА БОТА ==="
            check_auth || exit 1
            deploy_worker
            apply_schema
            seed_bearings
            seed_knowledge_base
            register_bot
            log_success "=== БОТ УСПЕШНО ЗАПУЩЕН ==="
            ;;
        *)
            log_error "Неизвестная команда: $1"
            echo "Использование: $0 [deploy|seed|register|full]"
            echo "  deploy   - деплой только Worker"
            echo "  seed     - загрузка только данных"
            echo "  register - регистрация только бота"
            echo "  full     - полная установка (по умолчанию)"
            exit 1
            ;;
    esac
}

main "$@"
