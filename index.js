
const express = require('express')
const { MongoClient, ServerApiVersion, Admin, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const app = express()
const port = process.env.PORT || 5000
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

//middleware 
app.use(cors())
app.use(express.json())

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized Access' })
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.JWT_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' })
        }
        req.decoded = decoded
        next()
    });

}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yfyay.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db("doctors_portal").collection("services");
        const bookingCollection = client.db("doctors_portal").collection("bookings");
        const userCollection = client.db("doctors_portal").collection("users");
        const doctorCollection = client.db("doctors_portal").collection("doctors");

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'forbidden' });
            }
        }


        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient
            // const authorization = req.headers.authorization
            // console.log('authorization', authorization);
            const decodedEmail = req.decoded.email
            if (decodedEmail === patient) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                res.send(bookings)
            } else {
                return res.status(403).send({ message: 'Forbidden Access' })
            }
        })

        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const booking = await bookingCollection.findOne(query)
            res.send(booking)
        })

        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 })
            const services = await cursor.toArray()
            res.send(services)

        })

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body
            const price = service.price


            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                amount: calculateOrderAmount(items),
                currency: "usd",
                automatic_payment_methods: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.post('/booking', async (req, res) => {
            const booking = req.body
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const exists = await bookingCollection.findOne(query)
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({ success: true, result })
        })
        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray()
            res.send(users)
        })

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin })
        })

        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email
            // const requester = req.decoded.email
            // const requsetAccount = await userCollection.findOne({ email: requester })
            // if (requsetAccount.role === 'admin') {
            const filter = { email: email }

            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result)
            // } else {
            //     res.status(403).send({ message: 'forbidden' })
            // }


        })

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email
            const user = req.body
            const filter = { email: email }
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.JWT_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token })

        })

        // Warning: This is not the proper way to query multiple collection. 
        // After learning more about mongodb. use aggregate, lookup, pipeline, match, group
        app.get('/available', async (req, res) => {
            const date = req.query.date;

            // step 1:  get all services
            const services = await serviceCollection.find().toArray();

            // step 2: get the booking of that day. output: [{}, {}, {}, {}, {}, {}]
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            // step 3: for each service
            services.forEach(service => {
                // step 4: find bookings for that service. output: [{}, {}, {}, {}]
                const serviceBookings = bookings.filter(book => book.treatment === service.name);
                // step 5: select slots for the service Bookings: ['', '', '', '']
                const bookedSlots = serviceBookings.map(book => book.slot);
                // step 6: select those slots that are not in bookedSlots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                //step 7: set available to slots to make it easier 
                service.slots = available;
            });


            res.send(services);
        })
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body
            const result = await doctorCollection.insertOne(doctor)
            res.send(result)
        })

        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        })
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email
            const filter = { email: email }
            const result = await doctorCollection.deleteOne(filter)
            res.send(result)
        })


    }
    finally { }
}

run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Doctors app listening on port ${port}`)
})