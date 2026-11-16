from datetime import datetime
from decimal import Decimal
from pathlib import Path
import random
from faker import Faker

fake = Faker()
random.seed()
Faker.seed()

def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"

lines = [
    "-- Dummy data for analytics dashboard testing",
    "BEGIN;",
    "",
    "INSERT INTO users (id, full_name, email) VALUES",
]

user_rows = []
for user_id in range(1, 501):
    full_name = fake.name()
    username = fake.user_name().replace("'", "").replace(" ", ".")
    email = f"{username}.{user_id}@example.com"
    user_rows.append(
        f"({user_id}, {sql_quote(full_name)}, {sql_quote(email)})"
    )

lines.append(",\n".join(user_rows) + ";")
lines.extend([
    "",
    "INSERT INTO orders (user_id, product_id, order_date, status, total_amount) VALUES"
])

statuses = ["delivered", "pending", "cancelled"]
weights = [75, 20, 5]
order_rows = []

for _ in range(1500):
    user_id = random.randint(1, 500)
    product_id = random.randint(1, 50)
    order_date = fake.date_time_between(start_date="-90d", end_date="now")
    timestamp = order_date.strftime("%Y-%m-%d %H:%M:%S")
    status = random.choices(statuses, weights=weights, k=1)[0]
    total_amount = Decimal(random.randint(2000, 50000)) / 100

    order_rows.append(
        f"({user_id}, {product_id}, {sql_quote(timestamp)}, "
        f"{sql_quote(status)}, {total_amount:.2f})"
    )

lines.append(",\n".join(order_rows) + ";")
lines.extend(["", "COMMIT;", ""])

Path("dashboard_seed.sql").write_text("\n".join(lines), encoding="utf-8")
print("Successfully generated dashboard_seed.sql!")