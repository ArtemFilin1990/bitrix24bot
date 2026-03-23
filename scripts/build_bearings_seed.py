#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

BRAND_COLUMNS = ("SKF", "FAG", "NSK", "NTN", "KOYO")
BRAND_FILES = (
    "data/brands.csv",
    "data/brands/brands.csv",
    "data/brands/manufacturers_cis.csv",
    "data/brands/manufacturers_europe.csv",
    "data/brands/manufacturers_asia.csv",
    "data/brands/manufacturers_china.csv",
)
ANALOG_FILES = (
    "data/analogs/gost_to_iso.csv",
    "data/analogs/iso_to_gost.csv",
    "data/analogs/import_analogs.csv",
)


@dataclass(frozen=True)
class BearingRow:
    article: str
    name: str
    brand: str
    weight: float | None


@dataclass(frozen=True)
class CatalogRow:
    item_id: str
    manufacturer: str | None
    category_ru: str | None
    subcategory_ru: str | None
    series_ru: str | None
    name_ru: str | None
    designation: str | None
    iso_ref: str | None
    section: str | None
    d_mm: float | None
    big_d_mm: float | None
    b_mm: float | None
    t_mm: float | None
    mass_kg: float | None
    analog_ref: str | None
    price_rub: float | None
    qty: int | None
    stock_flag: int
    bitrix_section_1: str | None
    bitrix_section_2: str | None
    bitrix_section_3: str | None
    gost_ref: str | None
    brand_display: str | None
    suffix_desc: str | None


@dataclass(frozen=True)
class AnalogRow:
    brand: str | None
    designation: str
    analog_designation: str
    analog_brand: str | None
    factory: str | None


@dataclass(frozen=True)
class BrandRow:
    name: str
    description: str
    logo_url: str | None
    search_url: str | None


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_value(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return sql_quote(str(value))


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(',', '.')
    if not text:
        return None
    return float(text)


def parse_int(value: str | None) -> int | None:
    num = parse_float(value)
    return None if num is None else int(num)


def normalized_text(*parts: str | None) -> str:
    return ' '.join(part.strip() for part in parts if part and part.strip())


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open('r', encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))


def build_bearings(master_rows: list[dict[str, str]]) -> list[BearingRow]:
    bearings: OrderedDict[tuple[str, str], BearingRow] = OrderedDict()
    for row in master_rows:
        iso = (row.get('ISO') or '').strip()
        gost = (row.get('GOST') or '').strip()
        article = iso or gost
        if not article:
            continue
        key = (article, 'Reference')
        bearings[key] = BearingRow(
            article=article,
            name=normalized_text(row.get('Type'), iso or gost) or article,
            brand='Reference',
            weight=parse_float(row.get('Weight_kg')),
        )
    return list(bearings.values())


def build_catalog(master_rows: list[dict[str, str]]) -> list[CatalogRow]:
    catalog: OrderedDict[str, CatalogRow] = OrderedDict()
    for row in master_rows:
        iso = (row.get('ISO') or '').strip()
        gost = (row.get('GOST') or '').strip()
        designation_fallback = iso or gost
        if not designation_fallback:
            continue
        for brand in BRAND_COLUMNS:
            designation = (row.get(brand) or '').strip()
            if not designation:
                continue
            item_id = f"{brand.lower()}:{designation.lower()}"
            catalog[item_id] = CatalogRow(
                item_id=item_id,
                manufacturer=brand,
                category_ru=(row.get('Type') or '').strip() or None,
                subcategory_ru=(row.get('Category') or '').strip() or None,
                series_ru=((designation[:2] + 'xx') if len(designation) >= 2 else None),
                name_ru=normalized_text((row.get('Type') or '').strip(), designation) or designation,
                designation=designation,
                iso_ref=iso or None,
                section='BearingsInfo master_catalog',
                d_mm=parse_float(row.get('d')),
                big_d_mm=parse_float(row.get('D')),
                b_mm=parse_float(row.get('B')),
                t_mm=None,
                mass_kg=parse_float(row.get('Weight_kg')),
                analog_ref=gost or None,
                price_rub=None,
                qty=None,
                stock_flag=0,
                bitrix_section_1='BearingsInfo',
                bitrix_section_2=(row.get('Category') or '').strip() or None,
                bitrix_section_3=(row.get('Status') or '').strip() or None,
                gost_ref=gost or None,
                brand_display=brand,
                suffix_desc=None,
            )
    return list(catalog.values())


def build_analogs(source_dir: Path) -> list[AnalogRow]:
    analogs: OrderedDict[tuple[str | None, str, str, str | None], AnalogRow] = OrderedDict()

    gost_to_iso = read_csv(source_dir / 'data/analogs/gost_to_iso.csv')
    for row in gost_to_iso:
        gost = (row.get('GOST') or '').strip()
        iso = (row.get('ISO') or '').strip()
        if gost and iso:
            analogs[("ГОСТ", gost, iso, "ISO")] = AnalogRow("ГОСТ", gost, iso, "ISO", row.get('Source') or 'gost_to_iso.csv')

    iso_to_gost = read_csv(source_dir / 'data/analogs/iso_to_gost.csv')
    for row in iso_to_gost:
        iso = (row.get('ISO') or '').strip()
        gost = (row.get('GOST') or '').strip()
        if iso and gost:
            analogs[("ISO", iso, gost, "ГОСТ")] = AnalogRow("ISO", iso, gost, "ГОСТ", row.get('Source') or 'iso_to_gost.csv')

    imports = read_csv(source_dir / 'data/analogs/import_analogs.csv')
    for row in imports:
        gost = (row.get('GOST') or '').strip()
        iso = (row.get('ISO') or '').strip()
        if gost and iso:
            analogs[("ГОСТ", gost, iso, "ISO")] = AnalogRow("ГОСТ", gost, iso, "ISO", row.get('Source') or 'import_analogs.csv')
        for brand in BRAND_COLUMNS:
            designation = (row.get(brand) or '').strip()
            if not designation:
                continue
            if iso and designation != iso:
                analogs[(brand, designation, iso, "ISO")] = AnalogRow(brand, designation, iso, 'ISO', row.get('Source') or 'import_analogs.csv')
                analogs[("ISO", iso, designation, brand)] = AnalogRow('ISO', iso, designation, brand, row.get('Source') or 'import_analogs.csv')
            if gost and designation:
                analogs[(brand, designation, gost, "ГОСТ")] = AnalogRow(brand, designation, gost, 'ГОСТ', row.get('Source') or 'import_analogs.csv')
                analogs[("ГОСТ", gost, designation, brand)] = AnalogRow('ГОСТ', gost, designation, brand, row.get('Source') or 'import_analogs.csv')
    return list(analogs.values())


def build_brands(source_dir: Path) -> list[BrandRow]:
    brands: OrderedDict[str, BrandRow] = OrderedDict()
    for rel_path in BRAND_FILES:
        path = source_dir / rel_path
        if not path.exists():
            continue
        for row in read_csv(path):
            name = (row.get('Name') or row.get('brand') or row.get('Brand') or '').strip()
            if not name:
                continue
            description = normalized_text(
                f"Страна: {(row.get('Country') or row.get('country') or '').strip()}." if (row.get('Country') or row.get('country')) else None,
                f"Компания: {(row.get('Company') or '').strip()}." if row.get('Company') else None,
                f"Тип: {(row.get('Type') or '').strip()}." if row.get('Type') else None,
                f"Уровень: {(row.get('Quality_Level') or row.get('segment') or '').strip()}." if (row.get('Quality_Level') or row.get('segment')) else None,
                f"Специализация: {(row.get('Specialization') or row.get('categories') or '').strip()}." if (row.get('Specialization') or row.get('categories')) else None,
                (row.get('Description') or row.get('notes') or row.get('Notes') or '').strip() or None,
            )
            search_url = (row.get('Search URL') or row.get('search_url') or row.get('Website') or '').strip() or None
            if search_url and not search_url.startswith(('http://', 'https://')):
                search_url = f'https://{search_url}'
            brands[name] = BrandRow(
                name=name,
                description=description or f'Импортировано из BearingsInfo ({rel_path}).',
                logo_url=(row.get('Logo URL') or '').strip() or None,
                search_url=search_url,
            )
    return list(brands.values())


def emit_sql(*, source_repo: str, source_snapshot: str, bearings: Iterable[BearingRow], catalog: Iterable[CatalogRow], analogs: Iterable[AnalogRow], brands: Iterable[BrandRow], stats: dict[str, int]) -> str:
    lines = [
        '-- Generated by scripts/build_bearings_seed.py',
        'BEGIN TRANSACTION;',
        f"INSERT INTO bearing_ingest_runs (source_snapshot, source_repo, files_seen, bearings_loaded, catalog_loaded, analogs_loaded, brands_loaded, finished_at, notes) VALUES ({sql_quote(source_snapshot)}, {sql_quote(source_repo)}, {stats['files_seen']}, {stats['bearings_loaded']}, {stats['catalog_loaded']}, {stats['analogs_loaded']}, {stats['brands_loaded']}, CURRENT_TIMESTAMP, 'seed build');",
        "DELETE FROM bearings WHERE brand = 'Reference';",
        "DELETE FROM catalog WHERE bitrix_section_1 = 'BearingsInfo';",
        "DELETE FROM analogs WHERE factory IN ('gost_to_iso.csv', 'iso_to_gost.csv', 'import_analogs.csv', 'Каталоги производителей');",
    ]
    if brands:
        brand_names = ', '.join(sql_quote(brand.name) for brand in brands)
        lines.append(f'DELETE FROM brands WHERE name IN ({brand_names});')

    for row in bearings:
        lines.append(
            'INSERT INTO bearings (article, name, brand, weight) VALUES '
            f'({sql_value(row.article)}, {sql_value(row.name)}, {sql_value(row.brand)}, {sql_value(row.weight)});'
        )
    for row in catalog:
        lines.append(
            'INSERT INTO catalog (item_id, manufacturer, category_ru, subcategory_ru, series_ru, name_ru, designation, iso_ref, section, d_mm, big_d_mm, b_mm, t_mm, mass_kg, analog_ref, price_rub, qty, stock_flag, bitrix_section_1, bitrix_section_2, bitrix_section_3, gost_ref, brand_display, suffix_desc) VALUES '
            f"({', '.join(sql_value(getattr(row, field)) for field in row.__dataclass_fields__)}) ON CONFLICT(item_id) DO UPDATE SET "
            "manufacturer=excluded.manufacturer, category_ru=excluded.category_ru, subcategory_ru=excluded.subcategory_ru, series_ru=excluded.series_ru, name_ru=excluded.name_ru, designation=excluded.designation, iso_ref=excluded.iso_ref, section=excluded.section, d_mm=excluded.d_mm, big_d_mm=excluded.big_d_mm, b_mm=excluded.b_mm, t_mm=excluded.t_mm, mass_kg=excluded.mass_kg, analog_ref=excluded.analog_ref, price_rub=excluded.price_rub, qty=excluded.qty, stock_flag=excluded.stock_flag, bitrix_section_1=excluded.bitrix_section_1, bitrix_section_2=excluded.bitrix_section_2, bitrix_section_3=excluded.bitrix_section_3, gost_ref=excluded.gost_ref, brand_display=excluded.brand_display, suffix_desc=excluded.suffix_desc;"
        )
    for row in analogs:
        lines.append(
            'INSERT INTO analogs (brand, designation, analog_designation, analog_brand, factory) VALUES '
            f'({sql_value(row.brand)}, {sql_value(row.designation)}, {sql_value(row.analog_designation)}, {sql_value(row.analog_brand)}, {sql_value(row.factory)});'
        )
    for row in brands:
        lines.append(
            'INSERT INTO brands (name, description, logo_url, search_url) VALUES '
            f'({sql_value(row.name)}, {sql_value(row.description)}, {sql_value(row.logo_url)}, {sql_value(row.search_url)}) '
            'ON CONFLICT(name) DO UPDATE SET description=excluded.description, logo_url=excluded.logo_url, search_url=excluded.search_url;'
        )
    lines.append('COMMIT;')
    return '\n'.join(lines) + '\n'


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--source-repo', default='ArtemFilin1990/BearingsInfo')
    parser.add_argument('--source-snapshot', default='manual')
    args = parser.parse_args()

    source_dir = Path(args.source_dir)
    master_path = source_dir / 'data/csv/master_catalog.csv'
    master_rows = read_csv(master_path)
    bearings = build_bearings(master_rows)
    catalog = build_catalog(master_rows)
    analogs = build_analogs(source_dir)
    brands = build_brands(source_dir)
    files_seen = sum(1 for rel in ('data/csv/master_catalog.csv', *ANALOG_FILES, *BRAND_FILES) if (source_dir / rel).exists())
    stats = {
        'files_seen': files_seen,
        'bearings_loaded': len(bearings),
        'catalog_loaded': len(catalog),
        'analogs_loaded': len(analogs),
        'brands_loaded': len(brands),
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        emit_sql(
            source_repo=args.source_repo,
            source_snapshot=args.source_snapshot,
            bearings=bearings,
            catalog=catalog,
            analogs=analogs,
            brands=brands,
            stats=stats,
        ),
        encoding='utf-8',
    )
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == '__main__':
    main()
