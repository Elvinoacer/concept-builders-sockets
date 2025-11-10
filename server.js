const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3001;
const NEXT_APP_URL =
  process.env.NODE_ENV !== "production"
    ? "http://localhost:3000"
    : process.env.NEXT_APP_URL;
const SOCKET_TO_NEXT_API_KEY = process.env.SOCKET_TO_NEXT_API_KEY;

const activeUsers = new Map();

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  const userId = socket.handshake.auth.token;

  if (!userId) {
    console.error(
      "Unauthorized socket connection: Missing userId in handshake"
    );
    socket.disconnect(true);
    return;
  }

  socket.on("join", (userId) => {
    activeUsers.set(userId, socket.id);
    console.log(`User ${userId} joined with socket ID ${socket.id}`);

    const currentlyOnlineUsers = Array.from(activeUsers.keys());
    socket.emit("currentOnlineUsers", currentlyOnlineUsers);

    io.emit("userOnline", userId);
  });

  socket.on("joinConversation", (conversationId) => {
    socket.join(conversationId);
    console.log(
      `Socket ${socket.id} joined conversation room ${conversationId}`
    );
  });

  socket.on("leaveConversation", (conversationId) => {
    socket.leave(conversationId);
    console.log(`Socket ${socket.id} left conversation room ${conversationId}`);
  });

  socket.on("getConversations", async () => {
    try {
      const response = await axios.get(
        `${NEXT_APP_URL}/api/conversations?userId=${userId}`,
        { headers: { "X-API-Key": SOCKET_TO_NEXT_API_KEY } }
      );
      socket.emit("conversations", response.data);
    } catch (error) {
      console.error("Error fetching conversations:", error.message);
      socket.emit("conversationsError", "Failed to fetch conversations.");
    }
  });

  socket.on("getAdminConversations", async ({ searchTerm, filter }) => {
    try {
      const response = await axios.get(
        `${NEXT_APP_URL}/api/conversations/all?userId=${userId}&q=${searchTerm}&filter=${filter}`,
        { headers: { "X-API-Key": SOCKET_TO_NEXT_API_KEY } }
      );
      socket.emit("adminConversations", response.data);
    } catch (error) {
      console.error("Error fetching admin conversations:", error.message);
      socket.emit(
        "adminConversationsError",
        "Failed to fetch admin conversations."
      );
    }
  });

  socket.on("getMessages", async (conversationId) => {
    try {
      const response = await axios.get(
        `${NEXT_APP_URL}/api/messages?conversationId=${conversationId}&userId=${userId}`,
        { headers: { "X-API-Key": SOCKET_TO_NEXT_API_KEY } }
      );
      socket.emit("messages", response.data);
    } catch (error) {
      console.error("Error fetching messages:", error.message);
      socket.emit("messagesError", "Failed to fetch messages.");
    }
  });

  socket.on("sendMessage", async (messageData) => {
    try {
      const messageWithSender = { ...messageData, senderId: userId };
      const response = await axios.post(
        `${NEXT_APP_URL}/api/messages`,
        messageWithSender,
        { headers: { "X-API-Key": SOCKET_TO_NEXT_API_KEY } }
      );
      const savedMessage = { ...response.data, tempId: messageData.tempId };
      io.to(messageData.conversationId).emit("receiveMessage", response.data);
      socket.emit("messageSent", savedMessage);
    } catch (error) {
      console.error("Error sending message:", error.message);
      socket.emit("sendMessageError", "Failed to send message.");
    }
  });

  socket.on("messageSeen", async ({ conversationId }) => {
    try {
      await axios.post(
        `${NEXT_APP_URL}/api/messages/seen`,
        { conversationId, userId },
        { headers: { "X-API-Key": SOCKET_TO_NEXT_API_KEY } }
      );
      io.to(conversationId).emit("messageSeen", { conversationId, userId });
    } catch (error) {
      console.error("Error marking message as seen:", error.message);
      socket.emit("messageSeenError", "Failed to mark message as seen.");
    }
  });

  socket.on("createConversation", async ({ recipientId, initialMessage }) => {
    try {
      const response = await axios.post(
        `${NEXT_APP_URL}/api/messages`,
        { recipientId, content: initialMessage, senderId: userId },
        { headers: { "X-API-Key": SOCKET_TO_NEXT_API_KEY } }
      );
      const newConversation = response.data.conversation;
      socket.emit("conversationCreated", newConversation);

      const recipientSocketId = activeUsers.get(recipientId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("newConversation", newConversation);
      }
    } catch (error) {
      console.error("Error creating conversation:", error.message);
      socket.emit("conversationError", "Failed to create conversation.");
    }
  });

  socket.on("typing", ({ conversationId, userId }) => {
    socket.to(conversationId).emit("typing", { conversationId, userId });
  });

  socket.on("stopTyping", ({ conversationId, userId }) => {
    socket.to(conversationId).emit("stopTyping", { conversationId, userId });
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    for (let [userId, socketId] of activeUsers.entries()) {
      if (socketId === socket.id) {
        activeUsers.delete(userId);
        io.emit("userOffline", userId);
        console.log(`User ${userId} (socket: ${socket.id}) went offline.`);
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Messaging server listening on port ${PORT}`);
});
