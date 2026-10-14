from agent_service.agents.specialist import build_specialist
from agent_service.prompts import SHOPPING_PROMPT

READ_TOOLS = {"check_stock", "get_product", "search_products"}
PROPOSAL_NAMES = {"propose_add_to_cart"}

shopping = build_specialist("shopping", READ_TOOLS, PROPOSAL_NAMES, SHOPPING_PROMPT)
