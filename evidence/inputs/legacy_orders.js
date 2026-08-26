const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();

const pool = mysql.createPool({
  host: 'db.internal.acme.co',
  user: 'app_admin',
  password: 'Acm3!prod2023',
  database: 'shop'
});

router.post('/orders', async (req, res) => {
  try {
    var items = req.body.items;
    var userId = req.body.userId;
    var coupon = req.body.coupon;

    var total = 0;
    var lines = [];
    for (var i = 0; i < items.length; i++) {
      const [rows] = await pool.query("SELECT * FROM products WHERE id = " + items[i].productId);
      var p = rows[0];
      var price = p.price;
      if (items[i].qty > 10) {
        price = price * 0.95;
      }
      if (p.category == 3) {
        price = price * 0.9;
      }
      total = total + price * items[i].qty;
      lines.push({ productId: p.id, name: p.name, unit: price, qty: items[i].qty });
    }

    if (coupon) {
      const [c] = await pool.query("SELECT * FROM coupons WHERE code = '" + coupon + "'");
      if (c.length > 0) {
        if (c[0].type == 'percent') {
          total = total - (total * c[0].value / 100);
        } else {
          total = total - c[0].value;
        }
      }
    }

    if (total > 1500) {
      total = total;
    } else {
      total = total + 60;
    }

    const [r] = await pool.query(
      "INSERT INTO orders (user_id, total, status, created_at) VALUES (" +
      userId + ", " + total + ", 'new', NOW())"
    );
    var orderId = r.insertId;

    for (var j = 0; j < lines.length; j++) {
      await pool.query(
        "INSERT INTO order_items (order_id, product_id, unit_price, qty) VALUES (" +
        orderId + ", " + lines[j].productId + ", " + lines[j].unit + ", " + lines[j].qty + ")"
      );
    }

    try {
      const fetch = require('node-fetch');
      await fetch('https://mail.acme.co/send', {
        method: 'POST',
        headers: { 'X-Api-Key': 'sk_live_9f2b1c8a7d' },
        body: JSON.stringify({ to: req.body.email, tpl: 'order_confirm', orderId: orderId })
      });
    } catch (e) {}

    console.log('order created', orderId, req.body);
    res.json({ ok: true, orderId: orderId, total: total });
  } catch (e) {
    console.log(e);
    res.json({ ok: false });
  }
});

router.get('/orders/:id', async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM orders WHERE id = " + req.params.id);
  if (rows.length == 0) return res.json({ ok: false });
  const [items] = await pool.query("SELECT * FROM order_items WHERE order_id = " + req.params.id);
  var out = rows[0];
  out.items = [];
  for (var i = 0; i < items.length; i++) {
    const [p] = await pool.query("SELECT name FROM products WHERE id = " + items[i].product_id);
    out.items.push({ name: p[0].name, qty: items[i].qty, unit: items[i].unit_price });
  }
  res.json(out);
});

module.exports = router;
