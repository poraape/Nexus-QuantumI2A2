describe('Nexus QuantumI2A2 smoke test', () => {
  it('loads the landing experience and displays key actions', () => {
    cy.visit('/');
    cy.contains('Nexus QuantumI2A2').should('exist');
    cy.contains('Upload de Arquivos').should('exist');
  });
});
