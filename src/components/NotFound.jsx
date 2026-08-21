import React, { useState, useEffect } from 'react';
import { strings } from '../strings';
import { ErrorPage } from './ErrorPage';

export function NotFound() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Show the address the way the user typed it: an un-decoded pathname turns
    // a stray non-ascii character into noise like "/%C4%B1ahskjdhs".
    let pathname = window.location.pathname;
    try { pathname = decodeURIComponent(pathname); } catch (e) { /* keep raw */ }

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
    <ErrorPage
      code="404"
      message={message}
      buttonLabel={strings.notFound.button}
      onButtonClick={handleBackHome}
    />
  );
}
