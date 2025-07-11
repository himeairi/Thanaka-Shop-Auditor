import { productCSVData, sampleOrders } from './data.js';

// ===================================
// == FIREBASE CONFIG
// ===================================
const firebaseConfig = {
  apiKey: "AIzaSyDMIl0gCaWjpcDHHBrM6HhYENi9edDDWKI",
  authDomain: "tiktok-audit-thanaka.firebaseapp.com",
  projectId: "tiktok-audit-thanaka",
  storageBucket: "tiktok-audit-thanaka.appspot.com",
  messagingSenderId: "95403940160",
  appId: "1:95403940160:web:c6b9096c61503c881842a5",
  measurementId: "G-H03BKG603V"
};

// ===================================
// == DOM ELEMENTS
// ===================================
const processBtn = document.getElementById('process-btn');
const copyBtn = document.getElementById('copy-btn');
const exportBtn = document.getElementById('export-btn');
const orderTextArea = document.getElementById('order-text');
const resultsSection = document.getElementById('results-section');
const resultsTableBody = document.getElementById('results-table-body');
const loadingDiv = document.getElementById('loading');
const totalRevenueEl = document.getElementById('total-revenue');
const totalCostEl = document.getElementById('total-cost');
const totalProfitEl = document.getElementById('total-profit');
const totalOrdersEl = document.getElementById('total-orders');
const editDataBtn = document.getElementById('edit-data-btn');
const saveDataBtn = document.getElementById('save-data-btn');
const cancelDataBtn = document.getElementById('cancel-data-btn');
const resetDataBtn = document.getElementById('reset-data-btn');
const productDataTableContainer = document.getElementById('product-data-table-container');
const notificationPopup = document.getElementById('notification-popup');

// ===================================
// == STATE
// ===================================
let processedOrdersData = [];
let masterProductData = {};
let db;
let auth;

// ===================================
// == CORE LOGIC
// ===================================

/**
 * Main controller to handle the order processing workflow.
 */
async function handleProcessOrders() {
    uiStartLoading();
    
    const orderText = orderTextArea.value;
    if (!orderText.trim()) {
        alert("Please paste your order text.");
        uiStopLoading();
        return;
    }

    try {
        const orders = parseOrders(orderText, masterProductData);

        if (orders.length === 0) {
            throw new Error("Could not parse any orders. Please check the text format and ensure product names in the pre-loaded data are correct.");
        }

        let totalRevenue = 0, totalCost = 0;
        
        for (const order of orders) {
            let currentOrderTotalCost = 0;
            for (const item of order.items) {
                const productInfo = findProductCost(item.productName, masterProductData);
                if (productInfo) {
                    currentOrderTotalCost += productInfo.cost * item.quantity;
                    item.matchedProduct = productInfo.matchedProduct;
                } else {
                    item.matchedProduct = { Matching_Keywords: 'NOT FOUND', Product_Name: item.productName, Image_URL: '' };
                }
            }
            
            order.cost = currentOrderTotalCost;
            // Profit calculation is removed
            
            totalRevenue += order.salePrice;
            totalCost += order.cost;
            processedOrdersData.push(order);
        }

        displayResults(processedOrdersData);

    } catch (error) {
        console.error("An error occurred during processing:", error);
        alert(`Error: ${error.message}`);
    } finally {
        uiStopLoading();
    }
}

// ===================================
// == DATA HANDLING
// ===================================

/**
 * Parses the product data from a CSV string into a usable format.
 * @param {string} csvString - The CSV data as a string.
 * @returns {{products: Array<Object>, skuMap: Map<string, Object>}}
 */
function parseProductSheet(csvString) {
    const workbook = XLSX.read(csvString.trim(), { type: 'string' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const products = XLSX.utils.sheet_to_json(sheet);
    products.sort((a, b) => (b.Matching_Keywords || '').length - (a.Matching_Keywords || '').length);
    const skuMap = new Map(products.map(p => [p.SKU, p]));
    return { products, skuMap };
}

/**
 * Parses orders by searching for known product names within each block of text.
 * @param {string} text - The raw text from the textarea.
 * @param {Object} productData - The pre-loaded product data.
 * @returns {Array<Object>} An array of structured order objects, where each object can contain multiple items.
 */
function parseOrders(text, productData) {
    const parsedOrders = [];
    const orderBlocks = text.split(/รหัสคำสั่งซื้อ:/).slice(1);

    for (const block of orderBlocks) {
        try {
            const orderIdRegex = /^\s*(\d+)/;
            const salePriceRegex = /฿\s*([\d,]+\.?\d*)/;

            const orderIdMatch = block.match(orderIdRegex);
            const salePriceMatch = block.match(salePriceRegex);

            if (!orderIdMatch || !salePriceMatch) {
                console.warn("Skipping block: Could not find Order ID or Sale Price.", block);
                continue;
            }

            const orderId = orderIdMatch[1].trim();
            const salePrice = parseFloat(salePriceMatch[1].replace(/,/g, ''));
            const items = [];

            let foundProducts = [];
            for (const product of productData.products) {
                if (block.includes(product.Matching_Keywords)) {
                    foundProducts.push(product);
                }
            }

            const finalProducts = foundProducts.filter(productA => {
                return !foundProducts.some(productB => 
                    productA.Matching_Keywords !== productB.Matching_Keywords && 
                    productB.Matching_Keywords.includes(productA.Matching_Keywords)
                );
            });
            
            for (const product of finalProducts) {
                const productNameIndex = block.indexOf(product.Matching_Keywords);
                const searchArea = block.substring(productNameIndex);
                const quantityMatch = searchArea.match(/×\s*(\d+)/);
                
                if (quantityMatch) {
                    items.push({
                        productName: product.Matching_Keywords,
                        quantity: parseInt(quantityMatch[1], 10)
                    });
                }
            }

            if (items.length > 0) {
                parsedOrders.push({
                    orderId,
                    salePrice,
                    items
                });
            }

        } catch (e) {
            console.error("An error occurred while parsing an order block:", e);
        }
    }
    return parsedOrders;
}


/**
 * Finds the correct product and calculates its cost.
 * @param {string} orderProductName - The product name from the parsed order.
 * @param {{products: Array<Object>, skuMap: Map<string, Object>}} productData
 * @returns {Object|null}
 */
function findProductCost(orderProductName, { products, skuMap }) {
    const bestMatch = products.find(p => p.Matching_Keywords === orderProductName);

    if (bestMatch) {
        let totalCost = 0;
        if (bestMatch.Bundle_Components) {
            const componentSKUs = String(bestMatch.Bundle_Components).split(',').map(s => s.trim());
            for (const sku of componentSKUs) {
                if (skuMap.has(sku)) {
                    totalCost += parseFloat(skuMap.get(sku).Cost_Price);
                }
            }
        } else {
            totalCost = parseFloat(bestMatch.Cost_Price);
        }
        return { cost: totalCost, matchedProduct: bestMatch };
    }
    return null;
}

// ===================================
// == FIREBASE FUNCTIONS
// ===================================

/**
 * Loads product data from Firestore or creates it from default if it doesn't exist.
 */
async function loadDataFromFirestore() {
    if (!auth.currentUser) {
        showNotification('❌ Not connected to the database. Please refresh.', true);
        return;
    }
    const userId = auth.currentUser.uid;
    const docRef = db.collection('productData').doc(userId);
    const doc = await docRef.get();

    if (doc.exists && doc.data().products && doc.data().products.length > 0) {
        const products = doc.data().products;
        masterProductData = {
            products,
            skuMap: new Map(products.map(p => [p.SKU, p]))
        };
        showNotification('✅ Loaded saved data from cloud.');
    } else {
        masterProductData = parseProductSheet(productCSVData);
        await saveMasterDataToFirestore();
        showNotification('No saved data found. Loaded default data and saved to cloud.');
    }
    renderProductTable(false);
}

/**
 * Reads data from the editable table and saves it to Firestore.
 */
async function updateAndSaveFromDOM() {
    if (!auth.currentUser) {
        alert("Cannot save. Not connected to the database. Please refresh the page and try again.");
        return;
    }

    const tableRows = productDataTableContainer.querySelectorAll('tbody tr');
    const updatedProducts = [];
    tableRows.forEach(row => {
        const sku = row.dataset.sku;
        const productToUpdate = { SKU: sku };
        row.querySelectorAll('input[data-key]').forEach(input => {
            const key = input.dataset.key;
            productToUpdate[key] = input.value;
        });
        updatedProducts.push(productToUpdate);
    });

    masterProductData.products = updatedProducts;
    
    await saveMasterDataToFirestore();

    renderProductTable(false);
    uiEndEditMode();
}

/**
 * Saves the current masterProductData object to Firestore.
 */
async function saveMasterDataToFirestore() {
    const userId = auth.currentUser.uid;
    const docRef = db.collection('productData').doc(userId);
    try {
        await docRef.set({ products: masterProductData.products });
        showNotification('✅ Product data saved to cloud!');
    } catch (error) {
        console.error("Error saving data to Firestore: ", error);
        showNotification('❌ Error saving data to cloud.', true);
    }
}

/**
 * Resets the data in Firestore to the default data from data.js.
 */
async function resetProductData() {
    if (!auth.currentUser) {
        alert("Cannot reset. Not connected to the database. Please refresh the page and try again.");
        return;
    }
    if (confirm("Are you sure you want to reset your data to the default? This will overwrite your cloud data.")) {
        masterProductData = parseProductSheet(productCSVData);
        await saveMasterDataToFirestore();
        renderProductTable(false);
    }
}


// ===================================
// == UI / VIEW FUNCTIONS
// ===================================

function uiStartLoading() {
    loadingDiv.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    processBtn.disabled = true;
    copyBtn.disabled = true;
    exportBtn.disabled = true;
    resultsTableBody.innerHTML = '';
    processedOrdersData = [];
}

function uiStopLoading() {
    loadingDiv.classList.add('hidden');
    processBtn.disabled = false;
    if (processedOrdersData.length > 0) {
        copyBtn.disabled = false;
        exportBtn.disabled = false;
    }
}

function uiStartEditMode() {
    renderProductTable(true);
    editDataBtn.classList.add('hidden');
    saveDataBtn.classList.remove('hidden');
    cancelDataBtn.classList.remove('hidden');
    resetDataBtn.classList.add('hidden');
}

function uiEndEditMode() {
    renderProductTable(false);
    editDataBtn.classList.remove('hidden');
    saveDataBtn.classList.add('hidden');
    cancelDataBtn.classList.add('hidden');
    resetDataBtn.classList.remove('hidden');
}

/**
 * Renders the results into the summary cards and the main table.
 * @param {Array<Object>} orders
 */
function displayResults(orders) {
    const totalRevenue = orders.reduce((sum, order) => sum + order.salePrice, 0);
    const totalCost = orders.reduce((sum, order) => sum + order.cost, 0);
    const formatCurrency = (num) => `฿${num.toFixed(2)}`;

    totalRevenueEl.textContent = formatCurrency(totalRevenue);
    totalCostEl.textContent = formatCurrency(totalCost);
    // Remove profit display
    if(totalProfitEl) totalProfitEl.parentElement.classList.add('hidden');
    totalOrdersEl.textContent = orders.length;

    resultsTableBody.innerHTML = ''; // Clear previous results
    orders.forEach(order => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';

        const productCellContent = order.items.map(item => `${item.matchedProduct.Product_Name} (x${item.quantity})`).join('<br>');
        const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
        const imageUrl = order.items[0]?.matchedProduct.Image_URL; // Get image of first item

        row.innerHTML = `
            <td class="px-4 py-3"><img src="${imageUrl || 'https://placehold.co/40x40/EEE/333?text=N/A'}" alt="Product Image" class="h-10 w-10 object-cover rounded"></td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${order.orderId}</td>
            <td class="px-4 py-3 text-sm text-gray-600">${productCellContent}</td>
            <td class="px-4 py-3 text-sm text-gray-800 text-center">${totalQuantity}</td>
            <td class="px-4 py-3 text-sm text-gray-800">${formatCurrency(order.salePrice)}</td>
            <td class="px-4 py-3 text-sm text-red-600">${formatCurrency(order.cost)}</td>
        `;
        resultsTableBody.appendChild(row);
    });

    resultsSection.classList.remove('hidden');
}

/**
 * Generates a clean HTML version of the report and copies it to the clipboard.
 */
function copyReportToClipboard() {
    if (processedOrdersData.length === 0) {
        alert("No data to copy. Please process orders first.");
        return;
    }

    const formatCurrency = (num) => `฿${num.toFixed(2)}`;
    const totalRevenue = processedOrdersData.reduce((sum, order) => sum + order.salePrice, 0);
    const totalCost = processedOrdersData.reduce((sum, order) => sum + order.cost, 0);

    let htmlString = `
        <h1>Sales Audit Summary</h1>
        <p><strong>Total Revenue:</strong> ${formatCurrency(totalRevenue)}</p>
        <p><strong>Total Cost:</strong> ${formatCurrency(totalCost)}</p>
        <p><strong>Total Orders:</strong> ${processedOrdersData.length}</p>
        <br>
        <table border="1" style="border-collapse: collapse; width: 100%;">
            <thead>
                <tr>
                    <th style="padding: 8px; text-align: left;">Order ID</th>
                    <th style="padding: 8px; text-align: left;">Product</th>
                    <th style="padding: 8px; text-align: left;">Qty</th>
                    <th style="padding: 8px; text-align: left;">Sale Price</th>
                    <th style="padding: 8px; text-align: left;">Total Cost</th>
                </tr>
            </thead>
            <tbody>
    `;

    processedOrdersData.forEach(order => {
        const productCellContent = order.items.map(item => `${item.matchedProduct.Product_Name} (x${item.quantity})`).join('<br>');
        const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
        htmlString += `
            <tr>
                <td style="padding: 8px;">${order.orderId}</td>
                <td style="padding: 8px;">${productCellContent}</td>
                <td style="padding: 8px;">${totalQuantity}</td>
                <td style="padding: 8px;">${formatCurrency(order.salePrice)}</td>
                <td style="padding: 8px;">${formatCurrency(order.cost)}</td>
            </tr>
        `;
    });

    htmlString += `</tbody></table>`;

    const tempEl = document.createElement('div');
    tempEl.style.position = 'absolute';
    tempEl.style.left = '-9999px';
    tempEl.innerHTML = htmlString;
    document.body.appendChild(tempEl);
    
    const range = document.createRange();
    range.selectNode(tempEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    
    try {
        document.execCommand('copy');
        showNotification('✅ Report copied to clipboard!');
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showNotification('❌ Failed to copy report.', true);
    }

    document.body.removeChild(tempEl);
}

/**
 * Generates and triggers the download of a .docx file.
 */
async function exportToWord() {
    if (processedOrdersData.length === 0) {
        alert("No data to export. Please process orders first.");
        return;
    }
    
    if (typeof window.docx === 'undefined') {
        alert('The export library is still loading. Please wait a moment and try again.');
        return;
    }

    uiStartLoading();
    
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel } = window.docx;
    const formatCurrency = (num) => `฿${num.toFixed(2)}`;
    const totalRevenue = processedOrdersData.reduce((sum, order) => sum + order.salePrice, 0);
    const totalCost = processedOrdersData.reduce((sum, order) => sum + order.cost, 0);

    const summaryItems = [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Sales Audit Summary")] }),
        new Paragraph({ children: [new TextRun({ text: `Total Revenue: ${formatCurrency(totalRevenue)}`, bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: `Total Cost: ${formatCurrency(totalCost)}`, bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: `Total Orders: ${processedOrdersData.length}`, bold: true })] }),
        new Paragraph({ text: "" }),
    ];

    const tableHeader = new TableRow({
        children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Details", bold: true })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Financials", bold: true })] })] }),
        ],
        tableHeader: true,
    });
    
    const tableRows = [tableHeader];

    for (const order of processedOrdersData) {
        const detailsParagraphs = [
            new Paragraph({ children: [new TextRun({ text: `Order ID: ${order.orderId}`, bold: true })] })
        ];

        order.items.forEach(item => {
            detailsParagraphs.push(new Paragraph(`${item.matchedProduct.Product_Name} (x${item.quantity})`));
            if (item.matchedProduct.Image_URL) {
                detailsParagraphs.push(new Paragraph({ 
                    children: [new TextRun({ text: `Image: ${item.matchedProduct.Image_URL}`, style: "Hyperlink" })],
                }));
            }
        });
        
        const detailsCell = new TableCell({ children: detailsParagraphs });

        const financialsCell = new TableCell({
            children: [
                new Paragraph(`Sale: ${formatCurrency(order.salePrice)}`),
                new Paragraph(`Cost: ${formatCurrency(order.cost)}`),
            ],
        });

        tableRows.push(new TableRow({ children: [detailsCell, financialsCell] }));
    }
    
    const table = new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } });
    const doc = new Document({
        styles: {
            hyperlink: {
                "Default Paragraph Font": {
                    run: {
                        color: "0000FF",
                        underline: {
                            type: "single",
                            color: "0000FF",
                        },
                    },
                },
            },
        },
        sections: [{ children: [...summaryItems, table] }]
    });
    
    try {
        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Sales_Report_${new Date().toISOString().split('T')[0]}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error("Error packing document:", e);
        alert("Failed to generate the Word document.");
    } finally {
        uiStopLoading();
    }
}

/**
 * Renders the product data table.
 * @param {boolean} isEditable - If true, renders inputs; otherwise, text.
 */
function renderProductTable(isEditable = false) {
    const table = document.createElement('table');
    table.className = 'min-w-full bg-white border border-gray-200';
    const thead = document.createElement('thead');
    thead.className = 'bg-gray-50';
    thead.innerHTML = `
        <tr>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product Name</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Matching Keywords</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost Price</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Image URL</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bundle Components</th>
        </tr>
    `;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-gray-200';

    masterProductData.products.forEach(product => {
        const row = document.createElement('tr');
        row.dataset.sku = product.SKU;
        if (isEditable) {
            row.innerHTML = `
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${product.SKU}</td>
                <td class="px-2 py-1"><input type="text" data-key="Product_Name" class="w-full p-1 border rounded" value="${product.Product_Name || ''}"></td>
                <td class="px-2 py-1"><input type="text" data-key="Matching_Keywords" class="w-full p-1 border rounded" value="${product.Matching_Keywords || ''}"></td>
                <td class="px-2 py-1"><input type="text" data-key="Cost_Price" class="w-24 p-1 border rounded" value="${product.Cost_Price || ''}"></td>
                <td class="px-2 py-1"><input type="text" data-key="Image_URL" class="w-full p-1 border rounded" value="${product.Image_URL || ''}"></td>
                <td class="px-2 py-1"><input type="text" data-key="Bundle_Components" class="w-full p-1 border rounded" value="${product.Bundle_Components || ''}"></td>
            `;
        } else {
            row.innerHTML = `
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${product.SKU}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${product.Product_Name || ''}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${product.Matching_Keywords || ''}</td>
                <td class="px-4 py-3 text-sm text-gray-800">${product.Cost_Price || ''}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${product.Image_URL || ''}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${product.Bundle_Components || ''}</td>
            `;
        }
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    productDataTableContainer.innerHTML = '';
    productDataTableContainer.appendChild(table);
}

/**
 * Shows a temporary popup to notify the user.
 * @param {string} message - The message to display.
 * @param {boolean} isError - If true, shows a red error popup.
 */
function showNotification(message, isError = false) {
    notificationPopup.textContent = message;
    notificationPopup.className = `fixed bottom-5 right-5 text-white py-3 px-5 rounded-lg shadow-lg transition-opacity duration-500 opacity-0 ${isError ? 'bg-red-500' : 'bg-green-500'}`;
    
    notificationPopup.classList.remove('hidden');
    setTimeout(() => notificationPopup.classList.remove('opacity-0'), 10);
    setTimeout(() => {
        notificationPopup.classList.add('opacity-0');
        setTimeout(() => notificationPopup.classList.add('hidden'), 500);
    }, 3000);
}

// ===================================
// == INITIALIZATION
// ===================================

async function initialize() {
    orderTextArea.value = sampleOrders;
    
    try {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();

        await auth.signInAnonymously();
        auth.onAuthStateChanged(async user => {
            if (user) {
                showNotification('☁️ Connected to cloud database...');
                await loadDataFromFirestore();
            }
        });
    } catch (e) {
        console.error("Firebase initialization failed:", e);
        showNotification('❌ Cloud connection failed. Using local data.', true);
        masterProductData = parseProductSheet(productCSVData);
        renderProductTable(false);
    }
    
    processBtn.addEventListener('click', handleProcessOrders);
    copyBtn.addEventListener('click', copyReportToClipboard);
    exportBtn.addEventListener('click', exportToWord);
    copyBtn.disabled = true;
    exportBtn.disabled = true;

    editDataBtn.addEventListener('click', uiStartEditMode);
    saveDataBtn.addEventListener('click', updateAndSaveFromDOM);
    cancelDataBtn.addEventListener('click', uiEndEditMode);
    resetDataBtn.addEventListener('click', resetProductData);
}

initialize();
