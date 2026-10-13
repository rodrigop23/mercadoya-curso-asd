import pytest

from agent_service.graph import route


@pytest.mark.parametrize(
    "category,active,expected,reason",
    [
        ("productos", None, "shopping", "productos"),
        ("carrito", "post_sale", "shopping", "carrito"),
        ("pedidos", None, "post_sale", "pedidos"),
        ("pagos_envios", "shopping", "post_sale", "pagos_envios"),
        *[
            (category, active, active or "shopping", "sticky")
            for category in ("preferencias", "conversacion")
            for active in (None, "shopping", "post_sale")
        ],
        (None, "post_sale", "post_sale", "sticky"),
        (None, "invalid", "shopping", "sticky"),
    ],
)
def test_router(category, active, expected, reason):
    state = {"last_domain_category": category, "active_agent": active}
    original = state.copy()
    result = route(state)
    assert result.goto == expected
    assert result.update == {"active_agent": expected, "route_reason": reason}
    assert state == original
