from calendar import c
from locust import HttpUser, SequentialTaskSet, task

# Suppresses insecure request warning.
from requests.packages.urllib3.exceptions import InsecureRequestWarning
import requests
import uuid
import json

import re

def get_product_id(content):
    result = re.search(br"name=\"add-to-cart\" value=\"(\d+)\"", content)
    return int(result.group(1))

# Note: SequentialTaskSet tasks are executed in order of declaration
class WooCommerceSequence(SequentialTaskSet):
    headers = {
        "Accept-Encoding": "gzip, deflate",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "DNT": "1",
        "Sec-GPC": "1",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:81.0) Gecko/20100101 Firefox/81.0"
    }
    redirect_path = None

    @task
    def home_page(self):
        # self.headers['Referer'] = self.client.ROBOSWARM__BASE_URL
        response = self.client.get("/", headers=self.headers, verify=False)

    @task
    def shop_page(self):
        # self.headers['Referer'] = self.client.ROBOSWARM__BASE_URL
        response = self.client.get("{{shop_url|safe}}", headers=self.headers, verify=False)

    @task
    def product_a(self):
        # self.headers['Referer'] = self.client.ROBOSWARM__BASE_URL
        response = self.client.get(
            "{{product_a_url|safe}}", headers=self.headers, verify=False)
        product_id = get_product_id(response.content)
        data = {
            "quantity": 1,
            "add-to-cart": product_id
        }
{% for attr in product_a_attributes %}
        data["{{attr.name|safe}}"] = "{{attr.value|safe}}"
{% endfor %}
        response = self.client.post(
            "{{product_a_url|safe}}", data, headers=self.headers, verify=False)

    @task
    def product_b(self):
        # self.headers['Referer'] = self.client.ROBOSWARM__BASE_URL
        response = self.client.get("{{product_b_url|safe}}", headers=self.headers, verify=False)
        product_id = get_product_id(response.content)
        data = {
            "quantity": "1",
            "add-to-cart": product_id
        }
{% for attr in product_b_attributes %}
        data["{{attr.name|safe}}"] = "{{attr.value|safe}}"
{% endfor %}
        response = self.client.post(
            "{{product_b_url|safe}}", data, headers=self.headers, verify=False)

    @task
    def cart(self):
        # self.headers['Referer'] = self.client.ROBOSWARM__BASE_URL
        response = self.client.get("{{cart_url|safe}}", headers=self.headers, verify=False)

    @task
    def checkout(self):
        # self.headers['Referer'] = self.client.ROBOSWARM__BASE_URL
        # Go to the cart page.
        response = self.client.get("{{checkout_url|safe}}", headers=self.headers, verify=False)

        # Extract the checkout none from the form.
        page_content = response.content
        # result = re.search(
        #     br"id=\"woocommerce-process-checkout-nonce\"\s* name=\"woocommerce-process-checkout-nonce\"\s* value=\"(\w+)\"", page_content)
        result = re.search(
            br'id="woocommerce-process-checkout-nonce"\s*name="woocommerce-process-checkout-nonce"\s*value="(\w+)"',
            page_content
        )
        if not result:
            print("❌ checkout nonce not found!")
            print(response.text[:500])  # print a snippet to debug
            return  # or skip, or handle the error gracefully
        checkout_nonce = result.group(1)

        # Data for update_order_review_nonce
        email = "test-{0}@example.com".format(str(uuid.uuid4()))
        checkout_data = {
            "billing_first_name": "James",
            "billing_last_name": "Doe",
            "billing_company": "Roboswarm.dev",
            "billing_country": "US",
            "billing_address_1": "1010101 First Street",
            "billing_address_2": "",
            "billing_city": "Manistee",
            "billing_state": "MI",
            "billing_postcode": "49660",
            "billing_phone": "555-555-5555",
            "billing_email": email,
            "billing_em_ver": email,
            "shipping_first_name": "James",
            "shipping_last_name": "Doe",
            "shipping_company": "Roboswarm.dev",
            "shipping_country": "US",
            "shipping_address_1": "1010101 First Street",
            "shipping_address_2": "",
            "shipping_city": "Manistee",
            "shipping_state": "MI",
            "shipping_postcode": "49660",
            "order_comments": "",
            "shipping_method[0]": "flat_rate:1",
            "payment_method": "cod",
            "privacy_policy": "1",
            "terms": "on",
            "terms-field": "1",
            "woocommerce-process-checkout-nonce": checkout_nonce,
        }

        dynamic_context = {
            "billing_email": email,
            "billing_em_ver": email,
            "woocommerce-process-checkout-nonce": checkout_nonce,
        }
{% if data_override %}
        extra_context = json.loads("""{{data_override|safe}}""")
{% else %}
        extra_context = {}
{% endif %}
        checkout_data.update(extra_context)
        checkout_data.update(dynamic_context)

        headers = self.headers
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        response = self.client.post(
            "/?wc-ajax=checkout", checkout_data, headers=headers)
        print(response.json())
        self.redirect_path = response.json()['redirect'].split(
            "order-received/").pop()

    @task
    def order_confirmed(self):
        # self.headers['Referer'] = self.client.ROBOSWARM__BASE_URL
        url = "{{checkout_url|safe}}/order-received/{0}".format(self.redirect_path)
        self.client.get(url, headers=self.headers, verify=False,
                        name="{{checkout_url|safe}}/order-received/:order_id")


class WooCommerceUser(HttpUser):
    tasks = {WooCommerceSequence: 1}
    wait_time = lambda x: 1