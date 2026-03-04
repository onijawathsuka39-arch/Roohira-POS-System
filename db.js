// Database Structure using Dexie.js
const db = new Dexie('RuhiraPOS_DB');

db.version(3).stores({
    inventory: '++id, name, category, type, stock, buyPrice, sellPrice, size, packageItems',
    sales: '++id, total, buyTotal, date, customer, paymentMethod',
    orders: '++id, orderId, customer, phone, address, items, total, status, deliveryStatus, deliveryMethod, paymentStatus, date',
    customers: '++id, custId, name, phone, address, totalOrders, totalSpent, isBlacklisted, loyaltyPoints',
    categories: '++id, name, description',
    notes: '++id, title, content, date',
    settings: 'key, value',
    backups: '++id, date, name, size'
});

// Helper functions for DB access
const DB = {
    // Notes
    getAllNotes: async () => await db.notes.toArray(),
    addNote: async (note) => await db.notes.add({ ...note, date: new Date().toISOString() }),
    deleteNote: async (id) => await db.notes.delete(id),

    // Orders
    getAllOrders: async () => await db.orders.orderBy('date').reverse().toArray(),
    addOrder: async (order) => await db.orders.add({ ...order, date: new Date().toISOString() }),
    updateOrderStatus: async (id, status) => await db.orders.update(id, { status }),
    updateOrderPaymentStatus: async (id, paymentStatus) => {
        const order = await db.orders.get(id);
        if (!order) return;

        // If newly marked as paid, convert order to sale
        if (paymentStatus === 'paid' && order.paymentStatus !== 'paid') {
            await DB.addSale({
                items: order.items,
                total: order.total,
                buyTotal: order.buyTotal || (order.items || []).reduce((sum, i) => sum + ((i.buyPrice || 0) * i.qty), 0),
                discount: order.discount || 0,
                delivery: order.delivery || 0,
                loyaltyDiscount: order.loyaltyDiscount || 0,
                date: new Date().toISOString(),
                customer: order.customer,
                customerId: order.customerId || 'Guest',
                customerPhone: order.phone || 'N/A',
                paymentMethod: 'cash'
            });
            await db.orders.update(id, { paymentStatus: 'paid', status: 'Paid' });
        } else {
            await db.orders.update(id, { paymentStatus });
        }
    },
    deleteOrder: async (id) => await db.orders.delete(id),

    // Settings
    getSetting: async (key) => {
        const s = await db.settings.get(key);
        return s ? s.value : null;
    },
    setSetting: async (key, value) => await db.settings.put({ key, value }),

    // Inventory
    getAllInventory: async () => await db.inventory.toArray(),
    getInventoryById: async (id) => await db.inventory.get(id),
    addInventory: async (item) => await db.inventory.add(item),
    updateInventory: async (id, changes) => await db.inventory.update(id, changes),
    deleteInventory: async (id) => await db.inventory.delete(id),

    // Sales
    getAllSales: async () => await db.sales.orderBy('date').reverse().toArray(),
    addSale: async (sale) => {
        // Update inventory stock for ALL items in the bill
        for (const item of sale.items) {
            const dbItem = await db.inventory.get(item.id || item.itemId);
            if (dbItem) {
                await db.inventory.update(dbItem.id, { stock: dbItem.stock - item.qty });
            }
        }

        // Update customer info (One bill = one order increment)
        if (sale.customer && sale.customer !== 'Guest') {
            const cust = await db.customers.where('name').equals(sale.customer).first();
            if (cust) {
                await db.customers.update(cust.id, {
                    totalOrders: (cust.totalOrders || 0) + 1,
                    totalSpent: (cust.totalSpent || 0) + sale.total
                });
            }
        }

        return await db.sales.add(sale);
    },

    // Customers
    getAllCustomers: async () => await db.customers.toArray(),
    getCustomerByName: async (name) => await db.customers.where('name').equals(name).first(),
    getCustomerById: async (custId) => await db.customers.where('custId').equals(custId).first(),
    addCustomer: async (customer) => {
        const count = await db.customers.count();
        const shortId = 'CUS-' + (100 + count + 1);
        return await db.customers.add({
            ...customer,
            custId: shortId,
            totalOrders: 0,
            totalSpent: 0,
            isBlacklisted: false,
            loyaltyPoints: 0
        });
    },
    updateCustomerPoints: async (id, points) => await db.customers.update(id, { loyaltyPoints: points }),
    updateCustomerStatus: async (id, isBlacklisted) => await db.customers.update(id, { isBlacklisted }),

    // Categories
    getAllCategories: async () => await db.categories.toArray(),
    addCategory: async (category) => await db.categories.add(category),

    // Stats calculation
    getDashboardStats: async () => {
        const sales = await db.sales.toArray();
        const inventory = await db.inventory.toArray();
        const customers = await db.customers.toArray();

        const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
        const totalProfit = sales.reduce((sum, s) => sum + (s.total - (s.buyTotal || 0)), 0);
        const lowStockCount = inventory.filter(i => i.stock <= 5).length;
        const totalOrders = sales.length;

        return { totalRevenue, totalProfit, totalOrders, totalCustomers: customers.length, lowStockCount };
    },

    // CSV Export Utility
    exportSalesToCSV: async () => {
        try {
            const sales = await db.sales.toArray();
            if (sales.length === 0) return alert('No sales data to export!');

            let csv = '\ufeffDate,Bill ID,Customer,Items,Total Amount,Net Profit\n';
            sales.forEach(s => {
                const date = new Date(s.date).toLocaleString().replace(/,/g, '');
                const itemsStr = (s.items || []).map(i => `${i.name}(x${i.qty})`).join('; ');
                const profit = s.total - (s.buyTotal || 0);
                csv += `${date},#SL-${s.id},"${s.customer || 'Guest'}","${itemsStr}",${s.total},${profit}\n`;
            });

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Ruhira_Sales_History_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            alert('Export failed: ' + err.message);
        }
    }
};
