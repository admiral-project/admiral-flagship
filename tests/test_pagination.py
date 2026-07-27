from app.bff.pagination import normalize_page, paginate_items, parse_paging_args


def test_parse_paging_args(app):
    with app.test_request_context("/?page=2&page_size=10"):
        page, page_size = parse_paging_args()
        assert page == 2
        assert page_size == 10


def test_parse_paging_args_invalid(app):
    with app.test_request_context("/?page=abc&page_size=xyz"):
        page, page_size = parse_paging_args()
        assert page == 1
        assert page_size == 20


def test_parse_paging_args_out_of_bounds(app):
    with app.test_request_context("/?page=0&page_size=200"):
        page, page_size = parse_paging_args()
        assert page == 1
        assert page_size == 100

    with app.test_request_context("/?page=-1&page_size=0"):
        page, page_size = parse_paging_args()
        assert page == 1
        assert page_size == 20


def test_paginate_items():
    items = list(range(100))
    result = paginate_items(items, 1, 20)
    assert result["items"] == list(range(20))
    assert result["total"] == 100
    assert result["page"] == 1
    assert result["page_size"] == 20

    result = paginate_items(items, 2, 20)
    assert result["items"] == list(range(20, 40))


def test_normalize_page_dict():
    data = {"items": [1, 2, 3], "page": 1, "page_size": 20, "total": 3}
    result = normalize_page(data, "my_key", 1, 20)
    assert result["my_key"] == [1, 2, 3]
    assert result["page"] == 1


def test_normalize_page_list():
    data = [1, 2, 3, 4, 5]
    result = normalize_page(data, "my_key", 1, 2)
    assert result["my_key"] == [1, 2]
    assert result["total"] == 5
    assert result["page_size"] == 2


def test_normalize_page_none():
    result = normalize_page(None, "my_key", 1, 20)
    assert result["my_key"] == []
    assert result["total"] == 0


def test_normalize_page_invalid():
    result = normalize_page("not a list or dict", "my_key", 1, 20)
    assert result["my_key"] == []
