require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const ejs = require("ejs");
const passportLocalMongoose = require("passport-local-mongoose");
const passport = require("passport");
const session = require("express-session");
const { mongoose, User, Course } = require("./utils/db"); // Import from db.js
const nodemailer = require('nodemailer');
const mongodb = require("mongodb");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const findOrCreate = require('mongoose-findorcreate');
const axios = require('axios');
const FormData = require('form-data');
const sendEmail = require('./utils/email');
const setRoutes = require('./utils/routes');
const crypto = require('crypto');
const emailAuth = require('./utils/emailAuth');
const LocalStrategy = require("passport-local").Strategy; // Import LocalStrategy
const { log } = require('console');
const jwt = require('jsonwebtoken');
const ccav = require('./utils/ccavenue');
const isAuthenticated = require('./utils/authMiddleware');
const bcrypt = require('bcrypt');
const JWT_SECRET = "med ejs is way to success";
let loggedIn = true;
// const enrollUserInCourse = require('./utils/enrollUser.js')
const app = express();
app.use(session({
  secret: "global med academy is way to success",
  resave: false,
  saveUninitialized: true
}));
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/assets', express.static(path.join(__dirname, 'assets')));


app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: "https://globalmedacademy.com/auth/google/test",
  userProfileURL: "https://www.googleapis.com/oauth2/v2/userinfo"
},
function(accessToken, refreshToken, profile, cb) {
  User.findOrCreate({ googleId: profile.id }, function (err, user) {
    return cb(err, user);
  });
}
));

// passport.use(new LocalStrategy({
//   usernameField: 'email',
// },User.authenticate()));

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id)
    .then(user => {
      done(null, user);
    })
    .catch(err => {
      done(err, null);
    });
});
// Configure LocalStrategy
// passport.use(
//   new LocalStrategy(
//     {
//       usernameField: "email", // Use "email" as the username field
//     },
//     User.authenticate()
//   )
// );
app.get("/auth/google",
  passport.authenticate('google', {
    scope: ['profile', 'email']
  })
);

app.get("/auth/google/test",
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.render('auth_index');
  }
);
// app.get('/login', isAuthenticated, function(req, res) {
//   res.render("login");
// });

// app.post("/login", passport.authenticate("local"), function(req, res) {
//     res.render("auth_index");
//   });

app.listen(3000, function() {
  console.log("Server started successfully!");
});

app.get("/logout", (req,res) => {
  req.logout(function(err){
    if (!err) {
      res.redirect("/");
    }
  });
});

// Store generated OTP
let storedOTP = null;

app.use(express.json()); // Add this middleware to parse JSON in requests

app.post('/sendOtp', async function(req, res) {
  const email = req.body.email;

  try {
    const isRegistered = await isEmailRegistered(email);

    if (isRegistered) {
      // If the email is already registered, send a JSON response with an error message
      return res.status(400).json({ success: false, message: "Email already in use." });
    }

    // Generate OTP and send email
    const otp = emailAuth.generateOTP();
    emailAuth.sendOTP(email, otp);

    // Store the generated OTP in the session
    req.session.otp = otp;
    req.session.email = email;

    // Send a JSON response indicating success
    return res.json({ success: true });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "An error occurred while sending OTP." });
  }
});

app.post('/verifyOtp', function(req, res) {
  const enteredOTP = req.body.otp;
  const storedOTP = req.session.otp;
  const { email, otp } = req.body;
  if (!storedOTP || enteredOTP !== storedOTP) {
    // Invalid OTP or no OTP found in the session
    return res.json({ success: false });
  }

  // OTP matches, authentication successful
  // You can redirect the user to the registration page or any other appropriate page
  return res.json({ success: true });
});

// jwt logic starts

app.post("/register",async (req,res) => {
  try {
    const { username, fullname, password } = req.body;

    
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // a new user
    const newUser = new User({ username,fullname, password: hashedPassword });
    await newUser.save();

    // res.status(201).json({ message: "User registered successfully" });
    res.render("auth_index");
  } catch (error) {
    console.error("Error while registering:", error);
    res.status(500).json({ error: "Error while registering" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET);

    // res.json({ token });
    res.render("auth_index");
  } catch (error) {
    console.error("Error while logging in:", error);
    res.status(500).json({ error: "Error while logging in" });
  }
});
const tokens = jwt.sign({ userId: User._id }, JWT_SECRET);
console.log(tokens);

app.get("/becometeacher", verifyToken, (req, res) => {
  // res.json({ message: "You have access to this protected route!" });
  res.render("becometeacher");
});

// Middleware to verify JWT token from the request header
function verifyToken(req, res, next) {
 
  // const token = req.header("Authorization");
  const token = tokens;
  // const headers = {
  //   Authorization: `Bearer ${token}`,
  // };

  if (!token) {
    return res.status(401).json({ error: "Unauthorized - Token missing" });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedToken) => {
    if (err) {
      return res.status(401).json({ error: "Unauthorized - Invalid token" });
    }

    req.userId = decodedToken.userId;
    next();
  });
}

// jwt logic ends 



// app.post("/register", async (req, res) => {

//   const { fullname, password ,email} = req.body; // Destructure fullname and password
// // Make sure the email field is not empty
// if (!email) {
//   return res.status(400).json({ error: "Email is required." });
// }
//   User.register({ username: email, name: fullname,email:email}, password, function (err, user) {
//     console.log(req.body.email);
//     if (err) {
//       console.log(err);
//     } else {
//       createUserInMoodle(email, password, fullname, '.', email)
//         .then(() => {
//           req.session.save();
//           passport.authenticate("local")(req, res, function () {
//             res.render("auth_index");
//             getUserIdFromUsername(email)
//           });
//         })
//         .catch((error) => {
//           console.error(error);
//           // Handle the error if necessary
//           res.status(500).send("An error occurred during user registration.");
//         });
//     }
//   });
// });

// async function isEmailRegistered(email) {
//   // Use mongoose to query for a user with the provided email
//   const user = await User.findOne({ email: email });

//   // If a user is found, the email is already registered
//   return user != null;
// }

// Function to create a user in Moodle
async function createUserInMoodle(username, password, firstname, lastname, email) {
  const formData = new FormData();
  formData.append('moodlewsrestformat', 'json');
  formData.append('wsfunction', 'core_user_create_users');
  formData.append('wstoken', process.env.MOODLE_TOKEN); // Replace with your Moodle token
  formData.append('users[0][username]', username);
  formData.append('users[0][password]', password);
  formData.append('users[0][firstname]', firstname);
  formData.append('users[0][lastname]', lastname);
  formData.append('users[0][email]', email);
  formData.append('users[0][lang]', 'en');
  formData.append('users[0][description]', 'If you die you die');

  try {
    const response = await axios.post('https://moodle.upskill.globalmedacademy.com/webservice/rest/server.php', formData, {
      headers: formData.getHeaders()
    });
    console.log(response.data);
    // Perform any necessary actions based on the response
  } catch (error) {
    console.error(error);
    throw new Error('Failed to create user in Moodle.');
  }
}
const getUserIdFromUsername = async (email) => {
  const formData = new FormData();
  formData.append('moodlewsrestformat', 'json');
  formData.append('wsfunction', 'core_user_get_users_by_field');
  formData.append('wstoken', process.env.MOODLE_TOKEN);
  formData.append('field', 'username');
  formData.append('values[0]', email);

  try {
    const response = await axios.post('https://moodle.upskill.globalmedacademy.com/webservice/rest/server.php', formData, {
      headers: formData.getHeaders()
    });

    if (response.status === 200 && response.data.length > 0) {
      console.log('User ID:', response.data[0].id);
      return response.data[0].id;  // Returns the user ID
    } else {
      throw new Error('User not found.');
    }
  } catch (error) {
    console.log(error);
    throw new Error('Failed to retrieve user ID.');
  }
};

const enrollUserInCourse = async (userId, courseid) => {
  const formData = new FormData();
  formData.append('moodlewsrestformat', 'json');
  formData.append('wsfunction', 'enrol_manual_enrol_users');
  formData.append('wstoken', process.env.MOODLE_TOKEN);
  formData.append('enrolments[0][roleid]', 5);
  formData.append('enrolments[0][userid]', userId);
  formData.append('enrolments[0][courseid]', courseid); // Fixed variable reference

  try {
    const response = await axios.post('https://moodle.upskill.globalmedacademy.com/webservice/rest/server.php', formData, {
      headers: formData.getHeaders()
    });

    if (response.status === 200) {
      console.log('User enrolled in the course successfully.');
      console.log(response.data);
    } else {
      console.log('Failed to enroll user in the course.');
      console.log(response.data);
    }
  } catch (error) {
    console.log(error);
    throw new Error('Failed to enroll user in the course.');
  }
};
// Usage
const userId = '15'; // Replace with the actual user ID
const courseid = '9'; // Replace with the actual Course ID
// enrollUserInCourse(userId, courseid);
setRoutes(app);
// sendEmail();