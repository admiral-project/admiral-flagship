# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

from flask import request

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def parse_paging_args():
    try:
        page = int(request.args.get("page", DEFAULT_PAGE))
    except (TypeError, ValueError):
        page = DEFAULT_PAGE
    try:
        page_size = int(request.args.get("page_size", DEFAULT_PAGE_SIZE))
    except (TypeError, ValueError):
        page_size = DEFAULT_PAGE_SIZE

    if page < 1:
        page = DEFAULT_PAGE
    if page_size < 1:
        page_size = DEFAULT_PAGE_SIZE
    if page_size > MAX_PAGE_SIZE:
        page_size = MAX_PAGE_SIZE
    return page, page_size


def paginate_items(items, page, page_size):
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "items": items[start:end],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


def normalize_page(data, key, page, page_size):
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        items = data["items"]
        return {
            key: items,
            "items": items,
            "page": data.get("page", page),
            "page_size": data.get("page_size", page_size),
            "total": data.get("total", len(items)),
        }

    if data is None:
        data = []
    if not isinstance(data, list):
        data = []

    payload = paginate_items(data, page, page_size)
    payload[key] = payload["items"]
    return payload
