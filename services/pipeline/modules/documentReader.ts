export interface PipelineDocument {
  name: string;
  content: string;
  type?: string;
}

export interface DocumentSection {
  id: string;
  documentName: string;
  index: number;
  text: string;
}

export interface ReadingOutput {
  documents: PipelineDocument[];
  sections: DocumentSection[];
  combinedText: string;
}

function buildSectionId(documentIndex: number, sectionIndex: number): string {
  return `doc-${documentIndex}-section-${sectionIndex}`;
}

export function readDocuments(documents: PipelineDocument[]): ReadingOutput {
  const sections: DocumentSection[] = [];
  const sanitizedDocuments = documents.map((doc) => ({
    ...doc,
    content: doc.content.replace(/\r\n/g, '\n'),
  }));

  sanitizedDocuments.forEach((document, documentIndex) => {
    const rawSections = document.content
      .split(/\n{2,}/)
      .map((section) => section.trim())
      .filter((section) => section.length > 0);

    rawSections.forEach((text, sectionIndex) => {
      sections.push({
        id: buildSectionId(documentIndex, sectionIndex),
        documentName: document.name,
        index: sectionIndex,
        text,
      });
    });
  });

  const combinedText = sections.map((section) => section.text).join('\n\n');

  return {
    documents: sanitizedDocuments,
    sections,
    combinedText,
  };
}
