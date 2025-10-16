import React from 'react';
import { AnalysisIcon } from './icons';

const Header: React.FC = () => {
  return (
    <header className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-700/50 sticky top-0 z-10">
      <div className="container mx-auto px-4 md:px-6 lg:px-8 py-4">
        <div className="flex items-center gap-3">
          <AnalysisIcon className="w-8 h-8 text-teal-300" />
          <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-300">
            Nexus QuantumI2A2
          </h1>
        </div>
        <p className="text-sm md:text-base text-gray-400 mt-1">
          Interactive Insight & Intelligence from Fiscal Analysis
        </p>
      </div>
    </header>
  );
};

export default Header;