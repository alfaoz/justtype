import React, { useState, useEffect } from 'react';
import { strings } from '../strings';

export function NotFound() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Get the current pathname
    const pathname = window.location.pathname;

    // Pick a random message from the array
    const messages = strings.notFound.messages;
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];

    // Call the message function with the pathname
    setMessage(randomMessage(pathname));
  }, []);

  const handleBackHome = () => {
    window.history.pushState({}, '', '/');
    window.location.reload();
  };

  return (
    <div className="h-screen bg-[#111111] text-[#a0a0a0] font-mono selection:bg-[#333333] selection:text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl md:text-8xl text-[#333] mb-8 font-light">404</div>
        <p className="text-lg md:text-xl text-[#808080] mb-8 leading-relaxed">
          {message}
        </p>
        <button
          onClick={handleBackHome}
          className="bg-[#1a1a1a] border border-[#333] text-white px-8 py-3 rounded hover:bg-[#222] hover:border-[#444] transition-all text-sm"
        >
          {strings.notFound.button}
        </button>
      </div>
    </div>
  );
}
