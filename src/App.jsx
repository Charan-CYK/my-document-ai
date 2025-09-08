import React, { useState, useRef, useEffect } from 'react';

// IMPORTANT: YOUR GEMINI API KEY IS NOW INSERTED HERE
// This key is visible in your frontend code. For production, consider a backend proxy.
const API_KEY = "AIzaSyBV6u3niiqi2j1deuwTkyVhmvRGj9MMwUU"; 

// Main App component
const App = () => {
  // State variables for managing input, output, loading status, and errors for summarization
  const [articleContent, setArticleContent] = useState(''); // Stores the text input by the user for summarization
  const [summary, setSummary] = useState(''); // Stores the generated summary
  const [isLoadingSummary, setIsLoadingSummary] = useState(false); // Indicates if summary API call is in progress
  const [summaryError, setSummaryError] = useState(''); // Stores any error messages for summarization

  // State variables for managing input, output, loading status, and errors for Q&A
  const [userQuestion, setUserQuestion] = useState(''); // Stores the user's current question about the summary
  const [chatHistory, setChatHistory] = useState([]); // Stores the conversation history for Q&A
  const [isLoadingAnswer, setIsLoadingAnswer] = useState(false); // Indicates if Q&A API call is in progress
  const [answerError, setAnswerError] = useState(''); // Stores any error messages for Q&A

  // Ref for the file input to allow programmatic clearing
  const fileInputRef = useRef(null);
  // Ref to store the pdfjsLib instance once loaded
  const pdfjsInstanceRef = useRef(null);
  // State to track if pdf.js is ready
  const [isPdfjsReady, setIsPdfjsReady] = useState(false);

  // Load pdf.js when the component mounts
  useEffect(() => {
    const loadPdfJs = async () => {
      try {
        // pdfjsLib is expected to be globally available via a script tag in index.html
        if (window.pdfjsLib) {
          pdfjsInstanceRef.current = window.pdfjsLib;
          // Set the worker source for pdf.js. This is crucial for PDF processing.
          // Using a CDN URL for the worker script
          pdfjsInstanceRef.current.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
          setIsPdfjsReady(true); // Mark pdf.js as ready
        } else {
          console.warn("pdfjsLib not found on window object. PDF reading might not work. Ensure pdf.js is loaded.");
          setIsPdfjsReady(false); // Mark pdf.js as not ready
        }
      } catch (error) {
        console.error("Failed to initialize pdf.js:", error);
        setIsPdfjsReady(false); // Mark pdf.js as not ready if an error occurs during initialization
      }
    };
    loadPdfJs();
  }, []); // Empty dependency array means this runs once on mount

  // Gemini API configuration
  const MODEL_NAME = "gemini-2.0-flash"; 
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;

  /**
   * Handles the summarization process.
   * Sends the article content to the Gemini API and updates the UI with the summary or error.
   */
  const handleSummarize = async () => {
    // Clear previous summary, errors, and chat history
    setSummary('');
    setSummaryError('');
    setChatHistory([]); // Clear chat history for new summary
    setUserQuestion(''); // Clear previous question
    setAnswerError(''); // Clear previous answer error

    // Validate input content
    if (!articleContent.trim()) {
      setSummaryError('Please enter some content or upload a document to summarize.');
      return;
    }

    // Validate API Key
    if (!API_KEY || API_KEY === "PASTE_YOUR_GEMINI_API_KEY_HERE" || API_KEY.startsWith("YOUR_")) { // Added startsWith for robustness
        setSummaryError("Please paste your Gemini API key at the top of App.jsx to use the service.");
        return;
    }

    setIsLoadingSummary(true); // Set loading state to true for summarization

    try {
      const payload = {
        contents: [
          {
            role: "user",
            parts: [
              { text: "You are a helpful assistant specialized in summarizing technical documentation. Summarize the following knowledge article concisely, highlighting key troubleshooting steps and resolutions. Focus on actionable advice." },
              { text: `Summarize this knowledge article:\n\n${articleContent}` }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 200, 
          temperature: 0.7, 
        }
      };

      const response = await fetch(`${API_URL}?key=${API_KEY}`, { // Use the API_KEY constant
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error?.message || `API error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
        setSummary(data.candidates[0].content.parts[0].text.trim());
      } else {
        setSummaryError('No summary received from the API. Please try again.');
      }
    } catch (err) {
      console.error("Summarization error:", err);
      setSummaryError(`Failed to summarize: ${err.message || 'An unknown error occurred.'}`);
    } finally {
      setIsLoadingSummary(false); // Reset loading state for summarization
    }
  };

  /**
   * Handles asking a question about the generated summary.
   * Sends the question and summary as context to the Gemini API, along with chat history.
   */
  const handleAskQuestion = async () => {
    setAnswerError(''); // Clear previous error

    if (!summary.trim()) {
      setAnswerError('Please generate a summary first before asking questions.');
      return;
    }
    if (!userQuestion.trim()) {
      setAnswerError('Please type a question about the summary.');
      return;
    }

    // Validate API Key
    if (!API_KEY || API_KEY === "PASTE_YOUR_GEMINI_API_KEY_HERE" || API_KEY.startsWith("YOUR_")) { // Added startsWith for robustness
        setAnswerError("Please paste your Gemini API key at the top of App.jsx to use the service.");
        return;
    }

    setIsLoadingAnswer(true); // Set loading state for Q&A

    // Add user's question to chat history immediately
    const updatedChatHistory = [...chatHistory, { role: 'user', text: userQuestion }];
    setChatHistory(updatedChatHistory);
    setUserQuestion(''); // Clear input field

    try {
      // Construct the full conversation history for the API call
      // The instruction to answer ONLY based on the summary is prepended to the current user's question.
      const conversationPayload = updatedChatHistory.map(message => ({
        role: message.role === 'user' ? 'user' : 'model', // Gemini uses 'model' for AI responses
        parts: [{ text: message.text }]
      }));

      // Prepend the summary and strict instruction to the *last* user message in the payload
      // This ensures the AI always has the grounding context for each turn.
      if (conversationPayload.length > 0 && conversationPayload[conversationPayload.length - 1].role === 'user') {
        const lastUserMessageIndex = conversationPayload.length - 1;
        conversationPayload[lastUserMessageIndex].parts[0].text = 
          `Based ONLY on the following summary, answer the question. If the information is not in the summary, state that you cannot answer based on the provided text.\n\nSummary:\n"${summary}"\n\nQuestion: "${conversationPayload[lastUserMessageIndex].parts[0].text}"`;
      }


      const payload = {
        contents: conversationPayload,
        generationConfig: {
          maxOutputTokens: 150, // Max tokens for the generated answer
          temperature: 0.2, // Lower temperature for more factual, less creative answers
        }
      };

      const response = await fetch(`${API_URL}?key=${API_KEY}`, { // Use the API_KEY constant
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error?.message || `API error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
        const aiResponseText = data.candidates[0].content.parts[0].text.trim();
        setChatHistory(prev => [...prev, { role: 'ai', text: aiResponseText }]);
      } else {
        setAnswerError('No answer received from the API. Please try again.');
        // If no answer, remove the last user message from history to allow re-typing
        setChatHistory(prev => prev.slice(0, prev.length - 1));
      }
    } catch (err) {
      console.error("Question answering error:", err);
      setAnswerError(`Failed to get answer: ${err.message || 'An unknown error occurred.'}`);
      // If error, remove the last user message from history to allow re-typing
      setChatHistory(prev => prev.slice(0, prev.length - 1));
    } finally {
      setIsLoadingAnswer(false); // Reset loading state for Q&A
    }
  };

  /**
   * Reads text content from a file (TXT or PDF).
   */
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setSummaryError('');
    setArticleContent(''); // Clear previous text content
    setSummary(''); // Clear summary
    setChatHistory([]); // Clear chat history
    setUserQuestion(''); // Clear question
    setAnswerError(''); // Clear error

    if (file.type === 'text/plain' || file.name.endsWith('.txt')) { // Also check file extension for robustness
      const reader = new FileReader();
      reader.onload = (e) => {
        setArticleContent(e.target.result);
      };
      reader.onerror = () => {
        setSummaryError('Failed to read TXT file. Please try again.');
      };
      reader.readAsText(file);
    } else if (file.type === 'application/pdf') {
      if (!isPdfjsReady || !pdfjsInstanceRef.current) {
        setSummaryError('PDF.js library is not ready. Please wait a moment and try again, or ensure pdf.js is loaded.');
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        const arrayBuffer = e.target.result;
        try {
          const pdfDocument = await pdfjsInstanceRef.current.getDocument({ data: arrayBuffer }).promise;
          let fullText = '';
          for (let i = 1; i <= pdfDocument.numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
          }
          setArticleContent(fullText);
          setSummaryError('');
        } catch (error) {
          console.error("Error processing PDF:", error);
          setSummaryError('Failed to process PDF file. It might be corrupted or complex. Please try another PDF or a TXT file.');
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        }
      };
      reader.onerror = () => {
        setSummaryError('Failed to read PDF file. Please try again.');
      };
      reader.readAsArrayBuffer(file);
    } else {
      setSummaryError('Unsupported file type. Please upload a .txt or .pdf file.');
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  /**
   * Clears the file input and the article content.
   */
  const clearFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ""; // Clear the file input element
    }
    setArticleContent(''); // Clear the text area content
    setSummary(''); // Clear summary
    setSummaryError(''); // Clear errors
    setAnswerError(''); // Clear errors
    setUserQuestion(''); // Clear question
    setChatHistory([]); // Clear chat history
  };

return (
<div className="app-container">
  <div className="card-panel">
    <h1 className="main-heading">Intelligent Assistant</h1>
    <p className="sub-heading">Summarize & Chat with Your Documents</p>

    {/* Input Section for Summarization */}
    <div className="input-section">
      <label htmlFor="articleContent" className="input-label">
        Paste your Document Content here, or Upload a Document (.txt or .pdf):
      </label>
      <div className="file-input-wrapper">
        <input
          type="file"
          id="fileInput"
          ref={fileInputRef}
          accept=".txt,.pdf"
          onChange={handleFileChange}
          className="custom-file-input"
          disabled={isLoadingSummary}
        />
        {articleContent && (
          <button
            onClick={clearFileInput}
            className="clear-button"
            disabled={isLoadingSummary}
          >
            Clear
          </button>
        )}
      </div>
      <textarea
        id="articleContent"
        className="text-area-input"
        placeholder="Or type/paste your content directly here..."
        value={articleContent}
        onChange={(e) => setArticleContent(e.target.value)}
        disabled={isLoadingSummary}
      ></textarea>
    </div>

    {/* Summarize Button */}
    <div className="button-group">
      <button
        onClick={handleSummarize}
        disabled={isLoadingSummary || !articleContent.trim()}
        className={`summarize-button ${isLoadingSummary || !articleContent.trim() ? 'summarize-button-disabled' : ''}`}
      >
        {isLoadingSummary ? (
          <span className="button-loading-content">
            <svg className="spinner-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Summarizing...
          </span>
        ) : (
          'Summarize Document'
        )}
      </button>
    </div>

    {/* Error Display for Summarization */}
    {summaryError && (
      <div className="error-message" role="alert">
        <strong className="error-bold">Error!</strong>
        <span className="error-text">{summaryError}</span>
      </div>
    )}

    {/* Summary Output Section */}
    {summary && (
      <div className="summary-output">
        <h2 className="summary-heading">Generated Summary:</h2>
        <p className="summary-content">{summary}</p>
      </div>
    )}

    {/* Q&A Section (conditionally rendered if summary exists) */}
    {summary && (
      <div className="chat-section">
        <h2 className="chat-heading">Chat with the Summary</h2>

        {/* Chat History Display */}
        <div className="chat-history">
          {chatHistory.length === 0 ? (
            <p className="chat-placeholder">Ask a question about the summary to start the conversation...</p>
          ) : (
            chatHistory.map((msg, index) => (
              <div key={index} className={`chat-message-wrapper ${msg.role === 'user' ? 'user-message-wrapper' : 'ai-message-wrapper'}`}>
                <div className={`chat-bubble ${msg.role === 'user' ? 'user-bubble' : 'ai-bubble'}`}>
                  <p className="chat-text">{msg.text}</p>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="chat-input-area">
          <input
            type="text"
            id="userQuestion"
            className="chat-question-input"
            placeholder="Ask a follow-up question..."
            value={userQuestion}
            onChange={(e) => setUserQuestion(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && userQuestion.trim() && !isLoadingAnswer) {
                handleAskQuestion();
              }
            }}
            disabled={isLoadingAnswer}
          />
          <button
            onClick={handleAskQuestion}
            disabled={isLoadingAnswer || !userQuestion.trim()}
            className={`send-button ${isLoadingAnswer || !userQuestion.trim() ? 'send-button-disabled' : ''}`}
          >
            {isLoadingAnswer ? (
              <svg className="spinner-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              'Send'
            )}
          </button>
        </div>

        {/* Error Display for Q&A */}
        {answerError && (
          <div className="error-message" role="alert">
            <strong className="error-bold">Error!</strong>
            <span className="error-text">{answerError}</span>
          </div>
        )}
      </div>
    )}

    {/* Instructions/Notes */}
    <div className="instructions-footer">
      <p>This tool uses Generative AI to condense documents and provide answers based on the generated summary.</p>
      <p className="mt-1">Always review the AI's output for accuracy and context, especially in regulated environments.</p>
    </div>
  </div>
</div>
);
};

export default App;