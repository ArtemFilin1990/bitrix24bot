#!/bin/bash
# Скрипт для запуска бота Bitrix24 на Cloudflare Workers
# Usage: ./run-bot.sh [setup|deploy|seed|register|check|full]

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
        log_info "Для локальной разработки выполните: wrangler login"
        log_info "Для CI/CD установите переменные CLOUDFLARE_API_TOKEN и CLOUDFLARE_ACCOUNT_ID"
        return 1
    fi
    log_success "Авторизация успешна"
    return 0
}

# ── Обновление wrangler.toml ────────────────────────────
# Обновляет database_id и/или KV id в обоих файлах wrangler.toml
update_wrangler_toml() {
    local field="$1"  # "database_id" or "kv_id"
    local value="$2"

    python3 -c "
import re, sys

field, value = sys.argv[1], sys.argv[2]
files = ['wrangler.toml']

for path in files:
    try:
        text = open(path, encoding='utf-8').read()
    except FileNotFoundError:
        continue

    if field == 'database_id':
        text = re.sub(
            r'(database_id\s*=\s*\")[^\"]*\"',
            r'\g<1>' + value + '\"',
            text,
        )
    elif field == 'kv_id':
        def _replace_kv(m):
            section = m.group(0)
            return re.sub(
                r'(\bid\s*=\s*\")[^\"]*\"',
                r'\g<1>' + value + '\"',
                section,
                count=1,
            )
        text = re.sub(
            r'(\[\[kv_namespaces\]\][^\[]*)',
            _replace_kv,
            text,
            count=1,
            flags=re.DOTALL,
        )

    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
" "$field" "$value"
}

# ── Проверка конфигурации wrangler.toml ──────────────────
check_config() {
    log_info "Проверка конфигурации wrangler.toml..."

    local errors=0

    # Worker name
    local name
    name=$(sed -n 's/^name\s*=\s*"\([^"]*\)".*/\1/p' wrangler.toml | head -1)
    if [ -n "$name" ]; then
        log_success "Worker name: ${name}"
    else
        log_error "Worker name не настроен в wrangler.toml"
        errors=$((errors + 1))
    fi

    # Entry point
    local main_entry
    main_entry=$(sed -n 's/^main\s*=\s*"\([^"]*\)".*/\1/p' wrangler.toml | head -1)
    if [ -n "$main_entry" ] && [ -f "$main_entry" ]; then
        log_success "Entry point: ${main_entry}"
    else
        log_error "Entry point '${main_entry}' не найден"
        errors=$((errors + 1))
    fi

    # D1 database_id
    local db_id
    db_id=$(sed -n 's/.*database_id\s*=\s*"\([^"]*\)".*/\1/p' wrangler.toml | head -1)
    if [ -n "$db_id" ]; then
        log_success "D1 database_id: ${db_id}"
    else
        log_error "database_id не настроен в wrangler.toml"
        log_info "Запустите: ./run-bot.sh setup"
        errors=$((errors + 1))
    fi

    # KV namespace id
    local kv_id
    kv_id=$(sed -n '/\[\[kv_namespaces\]\]/,/^\[/{s/^id\s*=\s*"\([^"]*\)".*/\1/p;}' wrangler.toml | head -1)
    if [ -n "$kv_id" ]; then
        log_success "KV namespace id: ${kv_id}"
    else
        log_error "KV namespace id не настроен в wrangler.toml"
        log_info "Запустите: ./run-bot.sh setup"
        errors=$((errors + 1))
    fi

    if [ "$errors" -eq 0 ]; then
        log_success "Конфигурация корректна"
        return 0
    else
        log_error "Найдено ошибок: $errors"
        return 1
    fi
}

# ── Создание ресурсов Cloudflare ─────────────────────────
setup_resources() {
    log_info "=== СОЗДАНИЕ РЕСУРСОВ CLOUDFLARE ==="

    check_auth || exit 1

    # ── D1 база данных ──
    log_info "Создание D1 базы данных bearings-catalog..."
    local d1_output
    if d1_output=$(wrangler d1 create bearings-catalog 2>&1); then
        local database_id
        database_id=$(echo "$d1_output" | sed -n 's/.*database_id\s*=\s*"\([^"]*\)".*/\1/p' | head -1)
        if [ -n "$database_id" ]; then
            log_success "D1 создана: database_id = ${database_id}"
            update_wrangler_toml "database_id" "$database_id"
            log_success "wrangler.toml обновлён с новым database_id"
        else
            log_warning "Не удалось извлечь database_id из вывода wrangler"
            echo "$d1_output"
            log_info "Скопируйте database_id вручную в wrangler.toml"
        fi
    else
        if echo "$d1_output" | grep -qi "already exists"; then
            log_warning "D1 база данных bearings-catalog уже существует"
            log_info "Убедитесь, что database_id в wrangler.toml соответствует существующей базе"
            log_info "Посмотреть список баз: wrangler d1 list"
        else
            log_error "Ошибка создания D1 базы данных:"
            echo "$d1_output"
            return 1
        fi
    fi

    # ── KV namespace ──
    log_info "Создание KV namespace CHAT_HISTORY..."
    local kv_output
    if kv_output=$(wrangler kv namespace create "CHAT_HISTORY" 2>&1); then
        local kv_id
        kv_id=$(echo "$kv_output" | sed -n 's/.*id\s*=\s*"\([^"]*\)".*/\1/p' | head -1)
        if [ -n "$kv_id" ]; then
            log_success "KV создан: id = ${kv_id}"
            update_wrangler_toml "kv_id" "$kv_id"
            log_success "wrangler.toml обновлён с новым KV id"
        else
            log_warning "Не удалось извлечь id из вывода wrangler"
            echo "$kv_output"
            log_info "Скопируйте id вручную в wrangler.toml"
        fi
    else
        if echo "$kv_output" | grep -qi "already.*exist\|already been taken"; then
            log_warning "KV namespace CHAT_HISTORY уже существует"
            log_info "Убедитесь, что id в wrangler.toml соответствует существующему namespace"
            log_info "Посмотреть список: wrangler kv namespace list"
        else
            log_error "Ошибка создания KV namespace:"
            echo "$kv_output"
            return 1
        fi
    fi

    # ── Секреты ──
    log_info "Установка секретов Cloudflare Workers..."
    echo ""
    echo "Введите значения секретов (они будут запрошены интерактивно)."
    echo "Подготовьте:"
    echo "  GEMINI_API_KEY    — ключ из Google AI Studio"
    echo "  B24_PORTAL        — URL портала Bitrix24 (например, company.bitrix24.ru)"
    echo "  B24_USER_ID       — ID пользователя для REST API"
    echo "  B24_TOKEN         — токен REST API Bitrix24"
    echo "  IMPORT_SECRET     — любая случайная строка для защиты эндпоинтов"
    echo "  WORKER_HOST       — домен воркера (например, bitrix24bot.xxx.workers.dev)"
    echo ""

    local secrets=(GEMINI_API_KEY B24_PORTAL B24_USER_ID B24_TOKEN IMPORT_SECRET WORKER_HOST)
    for secret_name in "${secrets[@]}"; do
        log_info "Установка секрета ${secret_name}..."
        if ! wrangler secret put "$secret_name"; then
            log_warning "Секрет ${secret_name} не установлен — можно установить позже"
        fi
    done

    log_success "=== РЕСУРСЫ CLOUDFLARE СОЗДАНЫ ==="
    echo ""
    log_info "Следующий шаг: ./run-bot.sh full"
}

# ── Деплой воркера ───────────────────────────────────────
deploy_worker() {
    log_info "Деплой Worker на Cloudflare..."
    wrangler deploy
    log_success "Worker успешно задеплоен"
}

# ── Применение схемы базы данных ─────────────────────────
apply_schema() {
    log_info "Применение миграций базы данных..."
    wrangler d1 migrations apply bearings-catalog --remote
    log_success "Миграции базы данных применены"
}

# ── Загрузка данных о подшипниках ────────────────────────
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

# ── Загрузка базы знаний ─────────────────────────────────
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

# ── Регистрация бота в Bitrix24 ──────────────────────────
register_bot() {
    log_info "Регистрация бота в Bitrix24..."

    # Определение URL воркера
    if [ -z "$WORKER_HOST" ]; then
        local worker_name
        worker_name=$(sed -n 's/^name\s*=\s*"\([^"]*\)".*/\1/p' wrangler.toml | head -1)
        echo -n "Введите WORKER_HOST (например, ${worker_name}.<subdomain>.workers.dev): "
        read -r WORKER_HOST
    fi

    if [ -z "$WORKER_HOST" ]; then
        log_error "WORKER_HOST не указан"
        return 1
    fi

    # Определение IMPORT_SECRET
    if [ -z "$IMPORT_SECRET" ]; then
        echo -n "Введите IMPORT_SECRET: "
        read -rs IMPORT_SECRET
        echo ""
    fi

    if [ -z "$IMPORT_SECRET" ]; then
        log_error "IMPORT_SECRET не указан"
        return 1
    fi

    WORKER_URL="https://${WORKER_HOST}"
    log_info "URL воркера: ${WORKER_URL}"

    RESULT=$(curl -sf "${WORKER_URL}/register?secret=${IMPORT_SECRET}" || echo '{"error":"curl failed"}')
    echo "$RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('ok'):
    print('\u2713 Бот зарегистрирован! BOT_ID =', d.get('bot_id'))
elif 'error' in d:
    print('\u2717 Ошибка:', d['error'])
    sys.exit(1)
"
    log_success "Бот успешно зарегистрирован"
}

# ── Основная логика ──────────────────────────────────────
show_help() {
    echo "Использование: $0 [setup|deploy|seed|register|check|full]"
    echo ""
    echo "Команды:"
    echo "  setup    — создание D1/KV ресурсов и установка секретов"
    echo "  deploy   — деплой Worker на Cloudflare"
    echo "  seed     — загрузка схемы и данных (каталог + база знаний)"
    echo "  register — регистрация бота в Bitrix24"
    echo "  check    — проверка конфигурации wrangler.toml"
    echo "  full     — полная установка (деплой + данные + регистрация)"
    echo ""
    echo "Первый запуск:"
    echo "  1. wrangler login"
    echo "  2. ./run-bot.sh setup"
    echo "  3. ./run-bot.sh full"
}

main() {
    case "${1:-full}" in
        setup)
            setup_resources
            ;;
        deploy)
            log_info "=== ДЕПЛОЙ WORKER ==="
            check_config || exit 1
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
        check)
            check_config
            ;;
        full)
            log_info "=== ПОЛНАЯ УСТАНОВКА БОТА ==="
            check_auth || exit 1
            check_config || exit 1
            deploy_worker
            apply_schema
            seed_bearings
            seed_knowledge_base
            register_bot
            log_success "=== БОТ УСПЕШНО ЗАПУЩЕН ==="
            ;;
        -h|--help|help)
            show_help
            ;;
        *)
            log_error "Неизвестная команда: $1"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
