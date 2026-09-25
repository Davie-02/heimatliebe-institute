/* Print button for server-generated documents (report cards, certificates, invoices, receipts). */
document.querySelectorAll('[data-print]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });
