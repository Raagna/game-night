"""Build Price Check's real-price packs from Open Prices (https://prices.openfoodfacts.org), the Open Food Facts
project that collects prices from shop receipts and price tags.

Usage:  python3 scripts/build-openprices-pack.py CACHE_DIR [--country US|CA] [--refresh] [--report report.txt]
Writes: public/data/prices-openprices.json (--country US, the default) or
        public/data/prices-openprices-ca.json (--country CA)

There is one pack per country: the US pack holds US-dollar prices paid in US shops, the Canada pack Canadian-dollar
prices paid in Canadian shops. Prices are never converted from one currency to the other.

The daily export (prices.jsonl.gz) only gives each price a product id, so this reads the API instead, whose
price records carry the product's name, brand, size and photo. Every price in the country's currency is fetched,
100 to a page, about a second apart, and each page is cached in CACHE_DIR so a rerun only refetches with --refresh.

A price is kept when it is for a whole product (not a per-kilo category price or produce sold by weight), is not
a sale price, was paid in a shop in the country in the last MAX_AGE_DAYS before the newest price, and is between
MIN_PRICE and MAX_PRICE. A product is kept when it has a name, a front photo and a brand or a size. Its price is the median of its kept prices, rounded to
the cent, and the pack notes how many receipts that came from and the month of the newest one. Products that
look the same (brand + name + size) are merged.

Licences: the price data is under the Open Database License (ODbL), product photos under CC BY-SA. The game
credits Open Prices and Open Food Facts wherever the pack is used (setup screen, CREDITS.md).

File format: {"source", "license", "built", "imageBase", "items": [[code, name, brand, size, cents, receipts,
"YYYY-MM", imagePath]]}, imagePath relative to imageBase.
"""
import json
import re
import statistics
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://prices.openfoodfacts.org/api/v1/prices?currency={currency}&size=100&order_by=id&page={page}"
USER_AGENT = "GameNight-PriceCheck-pack/1.0 (https://github.com/Raagna/game-night)"
IMAGE_BASE = "https://images.openfoodfacts.org/images/products/"
# Each pack: its file, the currency its prices are in, and the names Open Prices gives the shops' country.
COUNTRIES = {
    "US": {"out": "prices-openprices.json", "currency": "USD", "names": {"united states", "united states of america", "usa", "us"}},
    "CA": {"out": "prices-openprices-ca.json", "currency": "CAD", "names": {"canada", "ca"}},
}
MIN_PRICE, MAX_PRICE = 0.5, 80.0
MAX_AGE_DAYS = 730


def fetch_pages(cache, refresh, currency):
    cache.mkdir(parents=True, exist_ok=True)
    page, pages = 1, None
    while pages is None or page <= pages:
        path = cache / f"{currency.lower()}-{page:04d}.json"
        if refresh or not path.exists():
            request = urllib.request.Request(API.format(currency=currency, page=page), headers={"User-Agent": USER_AGENT})
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(request, timeout=60) as response:
                        path.write_bytes(response.read())
                    break
                except OSError as error:
                    if attempt == 3:
                        raise
                    print(f"page {page}: {error}; retrying", file=sys.stderr)
                    time.sleep(5 * (attempt + 1))
            time.sleep(1)
        data = json.loads(path.read_text(encoding="utf-8"))
        pages = data.get("pages") or 1
        if page % 50 == 0:
            print(f"page {page} of {pages}", file=sys.stderr)
        yield from data.get("items") or []
        page += 1


# Emoji (flags, hearts) that some contributors put in names and brands.
EMOJI = re.compile(r"[\U0001F000-\U0001FFFF\u2600-\u27BF\uFE0F]")
# A size or name like "$ per kg" or "varies" marks produce sold by weight: its price is for whatever was weighed.
WEIGHED = re.compile(r"\$\s*/?\s*per\b|\bper\s*(kg|lb|100\s*g)\b|/\s*(kg|lb)\b|\bvariable\b|\bvaries\b", re.I)


def tidy_name(name):
    name = EMOJI.sub("", str(name or ""))
    name = re.sub(r"\s+", " ", name).strip(" -,;:.")
    letters = [c for c in name if c.isalpha()]
    # Receipt-style ALL CAPS names read better in title case; mixed-case names are left as written.
    if letters and all(c.isupper() for c in letters):
        name = " ".join(w.capitalize() if len(w) > 2 else w.lower() for w in name.split())
        name = name[:1].upper() + name[1:]
    return name


def tidy_brand(product):
    # "Great Value • Walmart, Walmart Canada" -> "Great Value": the first brand, before any maker or shop.
    brand = EMOJI.sub("", str(product.get("brands") or "")).split(",")[0].split("•")[0]
    return re.sub(r"\s+", " ", brand).strip(" -;:.")


def size_of(product):
    quantity = re.sub(r"\s+", " ", str(product.get("quantity") or "")).strip()
    if quantity and len(quantity) <= 24:
        return quantity
    amount, unit = product.get("product_quantity"), product.get("product_quantity_unit")
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return ""
    if amount <= 0 or not unit:
        return ""
    return f"{amount:g} {unit}"


def image_path(url):
    url = str(url or "")
    return url[len(IMAGE_BASE):] if url.startswith(IMAGE_BASE) else None


def build(prices, report, country):
    kept, reasons = [], {}
    def skip(reason):
        reasons[reason] = reasons.get(reason, 0) + 1
    for p in prices:
        product = p.get("product") if isinstance(p.get("product"), dict) else None
        shop_country = str(((p.get("location") or {}).get("osm_address_country")) or "").strip().lower()
        try:
            price = float(p.get("price"))
        except (TypeError, ValueError):
            skip("no price"); continue
        if p.get("type") != "PRODUCT" or not product or p.get("price_per"):
            skip("not a whole product"); continue
        if p.get("price_is_discounted"):
            skip("sale price"); continue
        if shop_country not in country["names"] or p.get("currency") != country["currency"]:
            skip("not a shop in the country"); continue
        if p.get("duplicate_of"):
            skip("duplicate"); continue
        quantity = p.get("receipt_quantity")
        if quantity not in (None, "", "1", "1.000", 1, 1.0):
            skip("bought several"); continue
        if not MIN_PRICE <= price <= MAX_PRICE:
            skip("price out of range"); continue
        name, image = tidy_name(product.get("product_name")), image_path(product.get("image_url"))
        if len(name) < 3 or not re.search(r"[A-Za-z]{3}", name) or "�" in name:
            skip("no name"); continue
        if not image:
            skip("no photo"); continue
        brand, size = tidy_brand(product), size_of(product)
        if WEIGHED.search(size) or WEIGHED.search(name):
            skip("sold by weight"); continue
        if not brand and not size:
            skip("no brand or size"); continue
        kept.append((p, product, price, name, image, brand, size))

    newest = max(date.fromisoformat(p["date"]) for p, *_ in kept)
    cutoff = newest - timedelta(days=MAX_AGE_DAYS)
    groups = {}
    for p, product, price, name, image, brand, size in kept:
        if date.fromisoformat(p["date"]) < cutoff:
            skip("older than two years"); continue
        key = re.sub(r"[^a-z0-9]+", " ", f"{brand} {name} {size}".lower()).strip()
        group = groups.setdefault(key, {"code": product.get("code") or p.get("product_code"), "name": name, "brand": brand, "size": size, "image": image, "prices": [], "dates": []})
        group["prices"].append(price)
        group["dates"].append(p["date"])

    items = []
    for group in groups.values():
        cents = round(statistics.median(group["prices"]) * 100)
        items.append([str(group["code"]), group["name"][:80], group["brand"][:40], group["size"], cents, len(group["prices"]), max(group["dates"])[:7], group["image"]])
    items.sort(key=lambda item: item[0])

    lines = [f"prices read: {sum(reasons.values()) + len(kept)}", f"kept prices: {len(kept) - reasons.get('older than two years', 0)}",
             f"products: {len(items)}", f"newest price: {newest}", "skipped:"] + [f"  {reason}: {count}" for reason, count in sorted(reasons.items(), key=lambda kv: -kv[1])]
    bands = [(0, 200), (200, 500), (500, 1000), (1000, 2000), (2000, 8000)]
    lines.append("price bands: " + ", ".join(f"${a / 100:g}-${b / 100:g}: {sum(a <= i[4] < b for i in items)}" for a, b in bands))
    print("\n".join(lines))
    if report:
        Path(report).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return items


def main(argv):
    if not argv or argv[0].startswith("-"):
        sys.exit(__doc__)
    cache, refresh = Path(argv[0]), "--refresh" in argv
    report = argv[argv.index("--report") + 1] if "--report" in argv else None
    code = argv[argv.index("--country") + 1].upper() if "--country" in argv else "US"
    if code not in COUNTRIES:
        sys.exit(f"--country must be one of {', '.join(COUNTRIES)}")
    country = COUNTRIES[code]
    out = ROOT / "public" / "data" / country["out"]
    items = build(fetch_pages(cache, refresh, country["currency"]), report, country)
    pack = {
        "source": "Open Prices (https://prices.openfoodfacts.org), an Open Food Facts project",
        "license": "Prices: Open Database License (ODbL) 1.0. Product photos: Open Food Facts, CC BY-SA 3.0/4.0.",
        "country": code,
        "currency": country["currency"],
        "built": date.today().isoformat(),
        "imageBase": IMAGE_BASE,
        "items": items,
    }
    out.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[1:])
