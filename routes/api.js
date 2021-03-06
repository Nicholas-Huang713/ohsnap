const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Post = require('../models/post');
const Comment = require('../models/comment');
const jwt = require('jsonwebtoken');
const {registerValidation, loginValidation} = require('../validation');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const aws = require( 'aws-sdk' );
const multerS3 = require( 'multer-s3' );
const path = require( 'path' );
const url = require('url');
const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: process.env.PASSWORD
    }
})

//AWS SDK
const s3 = new aws.S3({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS,
    Bucket: process.env.BUCKET
});

//STORAGE
const imgUpload = multer({
    storage: multerS3({
        s3: s3,
        bucket: 'ohsnapbucket',
        acl: 'public-read',
        key: function (req, file, cb) {
        cb(null, path.basename( file.originalname, path.extname( file.originalname ) ) + '-' + Date.now() + path.extname( file.originalname ) )
        }
    }),
    fileFilter: function( req, file, cb ){
     checkFileType( file, cb );
    }
}).single('image');

//CHECK FOR IMAGE FILE
function checkFileType( file, cb ){
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test( path.extname( file.originalname ).toLowerCase());
    const mimetype = filetypes.test( file.mimetype );
    if( mimetype && extname ){
        return cb( null, true );
    } else {
        cb( 'Error: Images Only!' );
    }
}

//UPLOAD IMAGE TO S3
router.post('/img-upload', (req, res) => {
    imgUpload(req, res, (error) => {
        if(error){
            console.log( 'errors', error);
            res.json({error: error});
        } else {
            if( req.file === undefined ){
                console.log( 'Error: No File Selected!' );
                res.json( 'Error: No File Selected' );
            } else {
                const imageName = req.file.key;
                const imageLocation = req.file.location;
                const data = {
                    imageName, imageLocation
                }
                res.json(data);
            }
        }
    });
});

//UPLOAD REGISTRATION PROFILE IMAGE TO S3
router.post('/img-upload/:id', (req, res) => {
    imgUpload(req, res, (error) => {
        if(error){
            console.log( 'errors', error);
            res.json(error);
        } else {
            if( req.file === undefined ){
                console.log( 'Error: No File Selected!' );
                res.json( 'Error: No File Selected' );
            } else {
                const imageName = req.file.key;
                const imageLocation = req.file.location;
                User.updateOne({_id: req.params.id}, {$set: {imageName, imageData: imageLocation}})
                .then((res) => {
                    console.log("Success")
                })
                .catch((err) => {
                    res.status(400).send(err);
                })
            }
        }
    });
});

//LOGIN
router.post('/login', async (req, res) => {
    const {error} = loginValidation(req.body);
    if(error) return res.status(400).send(error.details[0].message);
    const user = await User.findOne({email: req.body.email});
    if(!user) return res.status(400).send('Email does not exist');
    const validPass = await bcrypt.compare(req.body.password, user.password);
    if(!validPass) return res.status(400).send('Invalid password');
    const token = jwt.sign({_id: user._id}, process.env.TOKEN_SECRET);
    res.header('auth-token', token).send(token);
});

//REGISTER
router.post('/register', async (req, res) => {
    const {error} = registerValidation(req.body);
    if(error) return res.status(400).json(error.details[0].message);
    const emailExist = await User.findOne({email: req.body.email});
    if(emailExist) return res.status(400).json('Email already exists');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.password, salt);
    const user = new User({
        firstname: req.body.firstname,
        lastname: req.body.lastname,
        email: req.body.email, 
        password: hashedPassword,
        subscribed: req.body.subscribed,
        imageData: "https://via.placeholder.com/500x450?text=No+Profile+Image+Chosen"
    });
    try{
        await user.save();
        const token = jwt.sign({_id: user._id}, process.env.TOKEN_SECRET);
        const data = {
            token,
            id: user._id
        }
        res.header('auth-token', token).send(data);
    } catch(err){
        res.status(400).send(err);
    }   
});

//CREATE NEW POST
router.post('/newpost', verifyToken, (req, res) => {
    const decodedId = jwt.verify(req.token,  process.env.TOKEN_SECRET);
    imgUpload(req, res, (error) => {
        if(error){
            console.log( 'errors', error);
            res.json({error: error});
        } else {
            if( req.file === undefined ){
                console.log( 'Error: No File Selected!' );
                res.json( 'Error: No File Selected' );
            } else {
                const imageName = req.file.key;
                const imageLocation = req.file.location;
                const newPost = new Post({
                    creatorId: decodedId, 
                    creatorName: req.body.creatorName,
                    profileImg: req.body.profileImg,
                    imageName,
                    imageData: imageLocation,
                    description: req.body.description
                });
                newPost.save();
                Post.find({creatorId: decodedId})
                .then((data) => {
                    User.updateOne({_id: decodedId}, {$inc: {posts: 1}})
                    .then(() => {
                        console.log("Added to posts");
                    })
                    .catch(err => res.json(err)); 
                    res.json(data);
                })
                .catch((err) => {
                    res.json(err);
                })

            }
        }
    });
});

//UPDATE USER PROFILE PHOTO
router.put('/updateprofileimg', verifyToken, async (req, res, next) => {
    const decodedId = await jwt.verify(req.token,  process.env.TOKEN_SECRET);
    imgUpload(req, res, (error) => {
        if(error){
            console.log( 'errors', error);
            res.json({error: error});
        } else {
            if( req.file === undefined ){
                console.log( 'Error: No File Selected!' );
                res.json( 'Error: No File Selected' );
            } else {
                const imageName = req.file.key;
                const imageLocation = req.file.location;
                User.updateOne({_id: decodedId},{$set:{imageData: imageLocation, imageName}})
                .then(() => {
                    Post.updateMany({creatorId: decodedId}, {$set:{profileImg: imageLocation}})
                    .then(() => {
                        Comment.updateMany({creatorId: decodedId}, {$set:{creatorImg: imageLocation}})
                            .then(() => {
                                User.findOne({_id: decodedId})
                                    .then((data) => {
                                        res.json(data);
                                    })
                                    .catch((error) => console.log('Error: ' + error));
                            })
                            .catch((error) => {console.log('Error: ' + error)});
                    })
                    .catch((error) => {console.log('Error: ' + error)});
                })
                .catch((error) => {console.log('Error: ' + error)});
            }
        }
    });
});   

//UPDATE USER PROFILE INFO
router.put('/updateprofile', verifyToken, async (req, res, next) => {
    const decodedId = jwt.verify(req.token,  process.env.TOKEN_SECRET);
    User.updateOne({_id: decodedId},{$set:{firstname : req.body.firstName, lastname: req.body.lastName, email: req.body.email}})
        .then(() => {
            Post.updateMany({creatorId: decodedId}, {$set:{creatorName: req.body.firstName}})
            .then(() => {
                Comment.updateMany({creatorId: decodedId}, {$set:{creatorName: req.body.firstName}})
                    .then(() => {
                        User.findOne({_id: decodedId})
                            .then((data) => {
                                res.json(data);
                            })
                            .catch((error) => console.log('Error: ' + error));
                    })
                    .catch((error) => {console.log('Error: ' + error)});
            })
            .catch((error) => {console.log('Error: ' + error)});
        })
    .catch((error) => {console.log('Error: ' + error)});
});

//UPDATE SINGLE POST IMAGE
router.put('/updatepostimg/:postId', verifyToken, async (req, res, next) => {
    const decodedId = await jwt.verify(req.token,  process.env.TOKEN_SECRET);
    imgUpload(req, res, (error) => {
        if(error){
            console.log( 'errors', error);
            res.json({error: error});
        } else {
            if( req.file === undefined ){
                console.log( 'Error: No File Selected!' );
                res.json( 'Error: No File Selected' );
            } else {
                const imageName = req.file.key;
                const imageLocation = req.file.location;
                Post.updateOne({_id: req.params.postId}, {$set: {
                    imageName, imageData: imageLocation
                }})
                .then(() => {
                    Post.findOne({_id: req.params.postId})
                    .then((data) => {res.json(data)})
                    .catch((error) => console.log('Error: ' + error))
                })
                .catch((error) => console.log('Error: ' + error));
            }
        }
    });
});   

//GET ALL USERS
router.get('/', (req, res) => {
    User.find({})
    .then((data) => {res.json(data)})
    .catch((error) => {console.log('Error: ' + error)});
});

//GET ALL USERS ORDER BY POSTS
router.get('/getusers', (req, res) => {
    User.find({}).sort({posts: -1})
    .then((data) => {res.json(data)})
    .catch((error) => {console.log('Error: ' + error)});
});

//GET LOGGED IN USER
router.get('/getuser', verifyToken, (req, res) => {
    jwt.verify(req.token,  process.env.TOKEN_SECRET, (err, decoded) => {
        if(err){
            res.sendStatus(403);
        } else {
            User.find({_id: decoded})
            .then((data) => {res.json(data)})
            .catch((error) => {console.log('Error: ' + error)});
        }
    })
});

//GET A SINGLE USER
router.get('/getuser/:id', verifyToken, (req, res) => {
    User.findOne({_id: req.params.id})
    .then((data) => {res.json(data)})
    .catch((error) => {console.log('Error: ' + error)});
});

//GET SINGLE POST
router.get('/getonepost/:postId', verifyToken, (req, res) => {
    Post.findOne({_id: req.params.postId})
    .then((data) => {res.json(data)})
    .catch((error) => {console.log('Error: ' + error)});
})

//GET LOGGED IN USER POSTS
router.get('/getloguserposts', verifyToken, (req, res) => {
    const decodedId = jwt.verify(req.token,  process.env.TOKEN_SECRET);
    Post.find({creatorId: decodedId})
    .then((data) => {res.json(data)})
    .catch((error) => {console.log('Error: ' + error)});
})

//GET ALL POSTS 
router.get('/getposts', (req, res) => {
    Post.find({}).sort({date: -1})
    .then((data) => {res.json(data)})
    .catch((error) => {console.log('Error: ' + error)});
})

//GET ONE USER'S POSTS
router.get('/getuserposts/:id', verifyToken, (req, res) => {
    Post.find({creatorId: req.params.id})
    .then((data) => {res.json(data)})
    .catch((error) => {console.log('Error: ' + error)});
})

//LIKE POST
router.put('/like', verifyToken, (req, res) => {
    const decodedId = jwt.verify(req.token,  process.env.TOKEN_SECRET);
    User.updateOne({_id: decodedId}, {$push: {favelist: req.body.id}})
    .then(() => {
        Post.updateOne({_id: req.body.id}, {$push: {likes: decodedId}})
        .then((data) => {res.json(data)})
        .catch((error) => {console.log('Error: ' + error)});
    })
    .catch(err => res.json(err));
});

//UNLIKE POST
router.put('/unlike', verifyToken, (req, res) => {
    const decodedId = jwt.verify(req.token,  process.env.TOKEN_SECRET);
    User.updateOne({_id: decodedId}, {$pull: {favelist: req.body.id}})
    .then(() => {
        Post.updateOne({_id: req.body.id}, {$pull: {likes: decodedId}})
        .then((data) => {res.json(data)})
        .catch((error) => {console.log('Error: ' + error)});
    })
    .catch(err => res.json(err));
});

//GET ALL COMMENTS
router.get('/getcomments', (req, res) => {
    Comment.find({})
    .then((data) => {res.json(data)})
    .catch((error) => {console.log('Error: ' + error)});
})

//GET ALL COMMENTS FROM POST
router.get('/getpostcomments/:id', verifyToken, (req, res) => {
    Comment.find({postId: req.params.id})
    .then((data) => {res.json(data)})
    .catch((error) => {console.log('Error: ' + error)});
})

//POST A COMMENT
router.put('/postcomment', verifyToken, (req, res) => {
    const decodedId = jwt.verify(req.token,  process.env.TOKEN_SECRET);
    const comment = new Comment({
        postId: req.body.postId,
        creatorId: decodedId,
        creatorName: req.body.creatorName,
        creatorImg: req.body.creatorImg, 
        content: req.body.content
    });
    Post.updateOne({_id: req.body.postId}, {$push: {comments: comment}})
    .then((data) => {
        comment.save();
        res.json(data)
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//EDIT POST DESCRIPTION
router.put('/editdescription/:postId', verifyToken, (req, res) => {
    const decodedId = jwt.verify(req.token,  process.env.TOKEN_SECRET);
    Post.updateOne({_id: req.params.postId}, {$set: {description: req.body.description}})
    .then(() => {
        Post.find({creatorId: decodedId})
        .then((data) => {
            res.json(data);
        })
        .catch((err) => {
            console.log(err);
        })
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//DELETE A POST
router.delete('/deletePost', verifyToken, (req, res) => {
    const decodedId = jwt.verify(req.token,  process.env.TOKEN_SECRET);
    Post.deleteOne({_id: req.body.postId})
        .then(() => {
            User.updateOne({_id: decodedId}, {$inc: {posts: -1}})
            .then(() => {
                Post.find({creatorId: decodedId})
                .then((data) => {
                    res.json(data);
                })
                .catch((error) => {console.log('Error: ' + error)});
            })
            .catch((error) => {console.log('Error: ' + error)});
        })
        .catch((error) => {console.log('Error: ' + error)});
})

//GIVE ADMIN RIGHTS TO USER
router.put('/makeAdmin/:id', verifyToken, (req,res) => {
    User.updateOne({_id: req.params.id}, {$set: {admin: true}})
    .then(() => {
        if(req.body.currentUserList === "all"){
            User.find({})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else if(req.body.currentUserList === "admin"){
            User.find({admin: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else {
            User.find({subscribed: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        }
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//REMOVE ADMIN RIGHTS
router.put('/removeAdmin/:id', verifyToken, (req,res) => {
    User.updateOne({_id: req.params.id}, {$set: {admin: false}})
    .then(() => {
        if(req.body.currentUserList === "all"){
            User.find({})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else if(req.body.currentUserList === "admin"){
            User.find({admin: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else {
            User.find({subscribed: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        }
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//DELETE A USER
router.delete('/deleteUser/:id', verifyToken, (req, res) => {
    User.deleteOne({_id: req.params.id})
        .then(() => {
            User.find({})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => {console.log('Error: ' + error)});
        })
    .catch((error) => {console.log('Error: ' + error)});
})
//ADMIN EDIT USER FIRST NAME
router.put('/editFirst/:id', verifyToken, (req,res) => {
    User.updateOne({_id: req.params.id}, {$set: {firstname: req.body.firstName}})
    .then(() => {
        Post.updateMany({creatorId: req.params.id}, {$set:{creatorName: req.body.firstName}})
        .then(() => {
            Comment.updateMany({creatorId: req.params.id}, {$set:{creatorName: req.body.firstName}})
                .then(() => {
                    if(req.body.currentUserList === "all"){
                        User.find({})
                        .then((data) => {
                            res.json(data);
                        })
                        .catch((error) => console.log('Error: ' + error));
                    } else if(req.body.currentUserList === "admin"){
                        User.find({admin: true})
                        .then((data) => {
                            res.json(data);
                        })
                        .catch((error) => console.log('Error: ' + error));
                    } else {
                        User.find({subscribed: true})
                        .then((data) => {
                            res.json(data);
                        })
                        .catch((error) => console.log('Error: ' + error));
                    }
                })
                .catch((error) => {console.log('Error: ' + error)});
        })
        .catch((error) => {console.log('Error: ' + error)});
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//ADMIN EDIT USER LAST NAME
router.put('/editLast/:id', verifyToken, (req,res) => {
    User.updateOne({_id: req.params.id}, {$set: {lastname: req.body.lastName}})
    .then(() => {
        if(req.body.currentUserList === "all"){
            User.find({})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else if(req.body.currentUserList === "admin"){
            User.find({admin: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else {
            User.find({subscribed: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        }
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//ADMIN EDIT USER EMAIL
router.put('/editEmail/:id', verifyToken, (req,res) => {
    User.updateOne({_id: req.params.id}, {$set: {email: req.body.email}})
    .then(() => {
        if(req.body.currentUserList === "all"){
            User.find({})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else if(req.body.currentUserList === "admin"){
            User.find({admin: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else {
            User.find({subscribed: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        }
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//ADMIN DELETE POST
router.delete('/deletePost/:id', verifyToken, (req, res) => {
    User.updateOne({_id: req.params.creatorId}, {$inc: {posts: -1}})
    .then(() => {
        Post.deleteOne({_id: req.params.id})
        .then(() => {
            Comment.deleteMany({creatorId: req.params.id})
            .then(() => {
                Post.find({})
                .then((data) => {
                    res.json(data);
                })
                .catch((error) => {console.log('Error: ' + error)});
            })
            .catch((error) => {console.log('Error: ' + error)});
        })
        .catch((error) => {console.log('Error: ' + error)});
    })
    .catch((error) => {console.log('Error: ' + error)});    
})

//ADMIN DELETE COMMENT
router.delete('/deleteComment/:id', verifyToken, (req, res) => {
    Comment.deleteOne({_id: req.params.id})
        .then(() => {
            Post.updateOne({_id: req.body.postId}, {$pull: {comments: req.params.id}})
            .then(() => {
                Comment.find({})
                .then((data) => {
                    res.json(data);
                })
                .catch((error) => {console.log('Error: ' + error)});
            })
            .catch((error) => {console.log('Error: ' + error)});
        })
    .catch((error) => {console.log('Error: ' + error)});
})

//SEND EMAIL TO USER
router.post('/emailUser', verifyToken, (req,res) => {
    let mailOptions = {
        from: 'ohsnapinfo713@gmail.com',
        to: req.body.email,
        subject: 'ohSnap Says Hello',
        html: `<h2>Hello ${req.body.name}!</h2> 
               <p>This is an official email from OhSnap!</p>
               <p>Please let us know if you have any questions. We'll be happy to help!</p>
               <p>Sincerely,</p>
               <p>The OhSnap Team</p>
               <p>ohsnapinfo713@gmail.com</p>`
    }
    transporter.sendMail(mailOptions, function(err, data) {
        if(err) {
            console.log('Error Occurred');
        } else {
            console.log('Email sent!')
        }
    });
})

//ADMIN SUBSCIBE USER
router.put('/subscribe/:id', verifyToken, (req,res) => {
    User.updateOne({_id: req.params.id}, {$set: {subscribed: true}})
    .then(() => {
        if(req.body.currentUserList === "all"){
            User.find({})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else if(req.body.currentUserList === "admin"){
            User.find({admin: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else {
            User.find({subscribed: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        }
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//ADMIN UNSUBSCRIBE USER
router.put('/unsubscribe/:id', verifyToken, (req,res) => {
    User.updateOne({_id: req.params.id}, {$set: {subscribed: false}})
    .then(() => {
        if(req.body.currentUserList === "all"){
            User.find({})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else if(req.body.currentUserList === "admin"){
            User.find({admin: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        } else {
            User.find({subscribed: true})
            .then((data) => {
                res.json(data);
            })
            .catch((error) => console.log('Error: ' + error));
        }
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//GET ALL ADMIN USERS
router.get('/getAdmins', verifyToken, (req,res) => {
    User.find({admin: true})
    .then((data) => {
        res.json(data);
    })
    .catch((error) => {console.log('Error: ' + error)});
})

//GET ALL SUBSCRIBED USERS
router.get('/getSubscribed', verifyToken, (req,res) => {
    User.find({subscribed: true})
    .then((data) => {
        res.json(data);
    })
    .catch((error) => {console.log('Error: ' + error)});
})

function verifyToken(req, res, next){
    const bearerHeader = req.headers['authorization'];
    if(typeof bearerHeader !== 'undefined'){
        const bearer = bearerHeader.split(' ');
        const bearerToken = bearer[1];
        req.token = bearerToken;
        next();
    } else {
        res.sendStatus(403);
    }
}

module.exports = router;