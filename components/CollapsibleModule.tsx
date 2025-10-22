import React from 'react';
import { ChevronDownIcon } from './icons';

interface CollapsibleModuleProps {
    title: string;
    description?: string;
    isCollapsed: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

const CollapsibleModule: React.FC<CollapsibleModuleProps> = ({ title, description, isCollapsed, onToggle, children }) => {
    return (
        <section
            className={`bg-gray-800/80 border border-gray-700/60 rounded-xl shadow-lg transition-all duration-300 overflow-hidden ${
                isCollapsed ? 'hover:border-gray-600/80' : 'border-blue-500/40'
            }`}
        >
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={!isCollapsed}
                className="w-full flex items-start justify-between gap-3 px-6 py-4 text-left hover:bg-gray-800/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
                <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
                    {description && <p className="text-xs text-gray-400 max-w-2xl">{description}</p>}
                </div>
                <ChevronDownIcon
                    className={`w-5 h-5 text-gray-400 transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`}
                />
            </button>
            <div
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                    isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
                }`}
            >
                <div
                    className={`overflow-hidden transition-opacity duration-300 ${
                        isCollapsed ? 'opacity-0' : 'opacity-100'
                    }`}
                >
                    <div className="px-6 pb-6 pt-2 space-y-6">{children}</div>
                </div>
            </div>
        </section>
    );
};

export default CollapsibleModule;
