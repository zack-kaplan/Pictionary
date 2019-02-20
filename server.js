// Require the packages we will use:
var http = require("http"),
	socketio = require("socket.io"),
	fs = require("fs");

//Room constructor
function Room(name, creator) {
	return { "name": name, "users": [], "scores": {}, "drawerIndex": 0, "word": "", "bannedUsers": [], "creator": creator, "passwordBool": false, "hashedPassword": "" };
}
//make a default room, add it to a list of rooms, and initialize user associative array
var defaultRoom = Room("defaultRoom", "admin");
var rooms = [defaultRoom];
var usersByUsername = [];
//basic word list for games
var words = ["cat", "dog", "table", "banana", "chair", "phone", "computer", "pencil", "tree", "train",
	"sun", "ghost", "flower", "cup", "pie", "cow", "snowflake", "bug", "book", "jar", "snake", "light",
"light", "lips", "apple", "slide", "socks", "smile", "coat", "shoe", "smile", "heart", "nose"];
// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
var app = http.createServer(function (request, response) {
	if (request.url === "/stylesheet.css") {
		fs.readFile("stylesheet.css", function (err, data) {
			if (err) return response.writeHead(500);
			response.writeHead(200, { "Content-Type": "text/css" });
			response.end(data);
		})
	}
	else {
		response.writeHead(200, { "Content-Type": "text/html" });
		fs.readFile("client.html", function (err, data) {
			if (err) return response.writeHead(500);
			response.writeHead(200);
			response.end(data);
		});
	}
})
app.listen(3456);
// Do the Socket.IO magic:
var io = socketio.listen(app);
io.sockets.on("connection", function (socket) {
	// This callback runs when a new Socket.IO connection is established.
	//auto join lobby and set username to nothing
	socket.join("lobby");
	socket.username = "";
	socket.room = "lobby";
	socket.on('drawing', function (data) {
		if (data.room != null && data.room != "lobby") {
			io.to(data.room).emit('drawing', data)
		}
	});
	socket.on('get_rooms', function (data) {
		//runs when user logs in or when they leave a room, so firsttime variable is required
		//displays main lobby page, handles duplicate user login
		if (data.firsttime == true) {
			if ((data.username in usersByUsername)) {
				io.to(socket.id).emit("username_taken");
			}
			else {
				socket.username = data.username;
				socket.room = "lobby";
				usersByUsername[data.username] = socket.id;
				io.to(socket.id).emit("rooms_list", { "rooms": rooms, "firsttime": data.firsttime })
			}
		}
		else {
			socket.room = "lobby";
			io.to(socket.id).emit("rooms_list", { "rooms": rooms, "firsttime": data.firsttime })
		}
	});
	socket.on('create_new_room', function (data) {
		//make a new public room and return the updated rooms list
		rooms.push(Room(data.roomName, data.username));
		io.to("lobby").emit("rooms_list", { "rooms": rooms })
	});
	socket.on('clear', function(data){
		//sends clear signal to whole room
		io.to(data.room).emit("clear");
	})
	socket.on('join_room', function (data) {
		//join room logic, handles bans
		//add username to username list in rooms, update client
		var currentRoom;
		for (let i in rooms) {
			if (rooms[i].name == data.name) {
				currentRoom = rooms[i];
			}
		}
		if (currentRoom.bannedUsers.indexOf(data.username) == -1) {
			socket.leave("lobby");
			socket.join(data.name);
			if (currentRoom.users.indexOf(data.username) == -1) {
				currentRoom.users.push(data.username);
			}
			currentRoom.scores[data.username] = 0;
			socket.room = currentRoom;
			//console.log(currentRoom);
			if (currentRoom.users.length == 2) {
				currentRoom.drawerIndex = 0;
				let wordIndex = Math.floor(Math.random() * words.length);
				let word = words[wordIndex];
				currentRoom.word = word;
				console.log(word);
				io.to(data.name).emit("start_round", { "room": currentRoom });
			}
			else if (currentRoom.users.length < 2) {
				io.to(data.name).emit("waiting_for_players", { "room": currentRoom });
			}
			else {
				io.to(data.name).emit("player_joined", { "room": currentRoom });
			}

		}
		else {
			io.to(socket.id).emit("banned");
		}
	});
	socket.on('guess', function (data) {
		//handles guesses, starts new round on correct guess and updates room on incorrect guess
		var currentRoom;
		for (let i in rooms) {
			if (rooms[i].name == data.room) {
				currentRoom = rooms[i];
			}
		}
		if (data.guess == currentRoom.word) {
			currentRoom.drawerIndex = (currentRoom.drawerIndex + 1) % currentRoom.users.length;
			let wordIndex = Math.floor(Math.random() * words.length);
			let word = words[wordIndex];
			currentRoom.word = word;
			console.log(word);
			currentRoom.scores[data.user] = currentRoom.scores[data.user] + 1;
			io.to(data.room).emit("start_round", { "room": currentRoom, "prev_winner": data.user, "prev_word": data.guess });
		}
		else{
			io.to(data.room).emit("wrong_guess", {"user":data.user, "guess":data.guess});
		}
	});
	
	socket.on("leave_room", function (data) {
		//handles user leaving room
		//remove username from user list, update client
		var currentRoom;
		for (let i in rooms) {
			if (rooms[i].name == data.room) {
				currentRoom = rooms[i];
			}
		}
		var index = currentRoom.users.indexOf(data.username);
		currentRoom.users.splice(index, 1);
		socket.room = "lobby";
		socket.leave(data["room"]);
		socket.join("lobby");
		if (currentRoom.users.length < 2) {
			io.to(data.room).emit("waiting_for_players", { "room": currentRoom });
		}
		else if (index == currentRoom.drawerIndex) {
			currentRoom.drawerIndex = currentRoom.drawerIndex % currentRoom.users.length;
			let wordIndex = Math.floor(Math.random() * words.length);
			let word = words[wordIndex];
			currentRoom.word = word;
			console.log(word);
			io.to(data.room).emit("start_round", { "room": currentRoom });
		}
		else {
			io.to(data.room).emit("player_joined", { "room": currentRoom });
		}

	});
	
	
	socket.on('disconnect', function () {
		//handles disconnects, lets new users use the old username, leave sockets etc.
		// remove the username from rooms
		if (socket.room != null && socket.username != null) {
			var index;
			for (let i in rooms) {
				index = rooms[i].users.indexOf(socket.username);
				if (index != -1) {
					rooms[i].users.splice(index, 1);
				}
			}
			//update room that socket left somehow
			for (var key in usersByUsername) {
				if (key == socket.username) {
					delete usersByUsername[key];
				}
			}
			if (socket.room === "lobby") {
				socket.leave(socket.room);
			}
			else {
				socket.leave(socket.room.name);
				//console.log(socket.room);
				if (socket.room.users.length < 2) {
					io.to(socket.room.name).emit("waiting_for_players", { "room": socket.room });
				}
				else if (index == socket.room.drawerIndex) {
					socket.room.drawerIndex = socket.room.drawerIndex % socket.room.users.length;
					let wordIndex = Math.floor(Math.random() * words.length);
					let word = words[wordIndex];
					socket.room.word = word;
					console.log(word);
					io.to(socket.room.name).emit("start_round", { "room": socket.room });
				}
				else {
					io.to(socket.room.name).emit("player_joined", { "room": socket.room });
				}
			}
		}
	});
});
