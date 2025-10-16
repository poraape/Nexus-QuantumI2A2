const getExportableContent = (element: HTMLElement) => {
    let content = '';
    const titleEl = element.querySelector('[data-export-title]');
    if (titleEl) {
        content += `# ${titleEl.textContent}\\n\\n`;
    }

    element.querySelectorAll('h4').forEach(h4 => {
        content += `## ${h4.textContent}\\n\\n`;
        let nextEl = h4.nextElementSibling;
        while(nextEl && nextEl.tagName !== 'H4') {
            if (nextEl.tagName === 'P') {
                content += `${nextEl.textContent}\\n\\n`;
            } else if (nextEl.tagName === 'UL') {
                nextEl.querySelectorAll('li').forEach(li => {
                    content += `- ${li.textContent}\\n`;
                });
                content += '\\n';
            } else if (nextEl.querySelector('.grid')) {
                 nextEl.querySelectorAll('.grid > div').forEach(metricDiv => {
                    const value = metricDiv.querySelector('p:nth-child(1)')?.textContent;
                    const metric = metricDiv.querySelector('p:nth-child(2)')?.textContent;
                    const insight = metricDiv.querySelector('p:nth-child(3)')?.textContent;
                    content += `**${metric}:** ${value}\\n_${insight}_\\n\\n`;
                 })
            }
             else {
                content += `${nextEl.textContent}\\n\\n`;
            }
            nextEl = nextEl.nextElementSibling;
        }
    });

    return content;
};

export const exportToMarkdown = async (element: HTMLElement, filename: string) => {
    const markdown = getExportableContent(element);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

export const exportToHtml = async (element: HTMLElement, filename: string, title: string) => {
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                body { font-family: sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 20px auto; padding: 20px; }
                h1, h2, h3, h4 { color: #1a1a1a; }
                .metric { border: 1px solid #eee; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
                .metric-value { font-size: 1.5em; font-weight: bold; }
            </style>
        </head>
        <body>
            ${element.innerHTML}
        </body>
        </html>
    `;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

export const exportToPdf = async (element: HTMLElement, filename: string) => {
    const { jsPDF } = window.jspdf;
    const canvas = await window.html2canvas(element, { 
      backgroundColor: '#1f2937', // bg-gray-800
      scale: 2
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    const ratio = imgWidth / imgHeight;
    const widthInPdf = pdfWidth - 20;
    let heightInPdf = widthInPdf / ratio;
    
    let heightLeft = imgHeight * (widthInPdf / imgWidth);
    let position = 10;

    pdf.addImage(imgData, 'PNG', 10, position, widthInPdf, heightInPdf);
    heightLeft -= (pdfHeight - 20);

    while (heightLeft > 0) {
      position = position - pdfHeight + 20;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 10, position, widthInPdf, heightInPdf);
      heightLeft -= (pdfHeight - 20);
    }
    
    pdf.save(`${filename}.pdf`);
};