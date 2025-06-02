import React, { useState, useRef, useEffect } from 'react';

// IMPORTANT: YOUR GEMINI API KEY IS NOW INSERTED HERE
// This key is visible in your frontend code. For production, consider a backend proxy.
const API_KEY = "AIzaSyDtI84MW3tfzls8PVKF5GnRsExniG98rUk"; 

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
    // Main container with a clean, light background and subtle gradient
    // Added a subtle gradient to the body background for visual interest
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans text-gray-800">
      <div className="bg-white p-6 sm:p-8 rounded-xl shadow-xl w-full max-w-4xl border border-blue-50">
        
        {/* Header Section */}
        <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-800 mb-2 text-center tracking-tight">
          Intelligent Assistant
        </h1>
        <p className="text-lg sm:text-xl font-medium text-blue-600 mb-8 text-center">
          Summarize & Chat with Your Documents
        </p>

        {/* Input Section for Summarization */}
        <div className="mb-8">
          <label htmlFor="articleContent" className="block text-base font-semibold text-gray-700 mb-3">
            Paste your Document Content here, or Upload a Document (.txt or .pdf):
          </label>
          <div className="flex items-center space-x-4 mb-4">
            <input
              type="file"
              id="fileInput"
              ref={fileInputRef} // Attach ref to the file input
              accept=".txt,.pdf" // Accept .txt and .pdf files
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-600
                file:mr-4 file:py-2 file:px-4
                file:rounded-full file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-100 file:text-blue-700
                hover:file:bg-blue-200 transition-all duration-200 cursor-pointer"
              disabled={isLoadingSummary}
            />
            {articleContent && ( // Show clear button only if content exists
              <button
                onClick={clearFileInput}
                className="px-4 py-2 rounded-full border border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-all duration-200 text-sm font-semibold shadow-sm"
                disabled={isLoadingSummary}
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            id="articleContent"
            className="w-full p-4 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 transition-all duration-200 text-gray-800 h-52 sm:h-72 resize-y shadow-sm"
            placeholder="Or type/paste your content directly here..."
            value={articleContent}
            onChange={(e) => setArticleContent(e.target.value)}
            disabled={isLoadingSummary} // Disable textarea while summarizing
          ></textarea>
        </div>

        {/* Summarize Button */}
        <div className="flex justify-center mb-8">
          <button
            onClick={handleSummarize}
            disabled={isLoadingSummary || !articleContent.trim()} // Disable button while loading or if no content
            className={`
              px-8 py-3 rounded-lg text-white font-semibold text-base tracking-wide
              transition-all duration-200 ease-in-out transform
              ${isLoadingSummary || !articleContent.trim()
                ? 'bg-blue-400 cursor-not-allowed opacity-70' // Lighter blue for disabled
                : 'bg-blue-700 hover:bg-blue-800 active:bg-blue-900 shadow-lg hover:shadow-xl' // Darker, richer blue for active
              }
            `}
          >
            {isLoadingSummary ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
          <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-3 rounded-lg relative mb-8 shadow-sm" role="alert">
            <strong className="font-bold">Error!</strong>
            <span className="block sm:inline ml-2">{summaryError}</span>
          </div>
        )}

        {/* Summary Output Section */}
        {summary && (
          <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 shadow-inner mb-8">
            <h2 className="text-xl font-semibold text-blue-800 mb-4">Generated Summary:</h2>
            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap text-base">{summary}</p>
          </div>
        )}

        {/* Q&A Section (conditionally rendered if summary exists) */}
        {summary && (
          <div className="mt-10 pt-8 border-t border-gray-200">
            <h2 className="text-2xl font-bold text-gray-700 mb-5 text-center">Chat with the Summary</h2>
            
            {/* Chat History Display */}
            <div className="bg-white p-4 rounded-lg mb-5 max-h-80 overflow-y-auto border border-blue-100 shadow-md">
              {chatHistory.length === 0 ? (
                <p className="text-gray-500 italic text-center text-sm">Ask a question about the summary to start the conversation...</p>
              ) : (
                chatHistory.map((msg, index) => (
                  <div key={index} className={`flex mb-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`p-3 rounded-xl max-w-[80%] ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-none' // User bubble
                        : 'bg-blue-50 text-blue-800 rounded-bl-none' // AI bubble (light blue)
                    } shadow-sm`}>
                      <p className="text-sm">{msg.text}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mb-5 flex space-x-3">
              <input
                type="text"
                id="userQuestion"
                className="flex-grow p-3 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-500 transition-all duration-200 text-gray-800 shadow-sm"
                placeholder="Ask a follow-up question..."
                value={userQuestion}
                onChange={(e) => setUserQuestion(e.target.value)}
                onKeyPress={(e) => { // Allow pressing Enter to ask question
                  if (e.key === 'Enter' && userQuestion.trim() && !isLoadingAnswer) {
                    handleAskQuestion();
                  }
                }}
                disabled={isLoadingAnswer} // Disable input while answering
              />
              <button
                onClick={handleAskQuestion}
                disabled={isLoadingAnswer || !userQuestion.trim()} // Disable button if loading or no question
                className={`
                  px-6 py-3 rounded-lg text-white font-semibold text-base
                  transition-all duration-200 ease-in-out transform
                  ${isLoadingAnswer || !userQuestion.trim()
                    ? 'bg-blue-400 cursor-not-allowed opacity-70' // Lighter blue for disabled
                    : 'bg-blue-700 hover:bg-blue-800 active:bg-blue-900 shadow-md hover:shadow-lg' // Darker, richer blue for active
                  }
                `}
              >
                {isLoadingAnswer ? (
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
              <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-3 rounded-lg relative mb-8 shadow-sm" role="alert">
                <strong className="font-bold">Error!</strong>
                <span className="block sm:inline ml-2">{answerError}</span>
              </div>
            )}
          </div>
        )}

        {/* Instructions/Notes */}
        <div className="mt-10 pt-6 border-t border-blue-100 text-center text-sm text-gray-500">
          <p>This tool uses Generative AI to condense documents and provide answers based on the generated summary.</p>
          <p className="mt-1">Always review the AI's output for accuracy and context, especially in regulated environments.</p>
        </div>
      </div>
    </div>
  );
};

export default App;