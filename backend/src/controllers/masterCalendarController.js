const MasterCalendarEvent = require('../models/MasterCalendarEvent');

// ── Seed data: recurring Chhattisgarh monitoring calendar ──────────
// Fixed-date state observances are exact; lunar festivals carry "Date varies
// each year" and should be re-dated annually by an operator.
const RECURRING_SEED = [
  { slNo: 1,  occasion: 'New Year celebrations',                                  date: '1 January',    monitoringRange: '30 Dec – 2 Jan',   keywords: 'New Year, Raipur, Bhilai, crowd, drunk driving, traffic', remarks: 'Law & order' },
  { slNo: 2,  occasion: 'Chherchhera (Paush Purnima)',                            date: 'December/January', monitoringRange: '± 1 day',      keywords: 'Chherchhera, छेरछेरा, dhan daan, Paush Purnima',          remarks: 'Chhattisgarhi harvest festival — date varies' },
  { slNo: 3,  occasion: 'Makar Sankranti',                                        date: '14 January',   monitoringRange: '13 Jan – 15 Jan',  keywords: 'Sankranti, Makar Sankranti, til',                         remarks: '' },
  { slNo: 4,  occasion: 'Republic Day',                                           date: '26 January',   monitoringRange: '24 Jan – 28 Jan',  keywords: 'Republic Day, 26 January, parade, national flag, Raipur', remarks: 'High priority' },
  { slNo: 5,  occasion: 'Mahatma Gandhi Punyatithi',                              date: '30 January',   monitoringRange: '29 Jan – 31 Jan',  keywords: 'Mahatma Gandhi, martyrdom',                               remarks: '' },
  { slNo: 6,  occasion: 'Paddy procurement season closes',                        date: '31 January',   monitoringRange: 'November – January', keywords: 'dhan kharidi, धान खरीदी, MSP, 3100, token, samiti, farmers, paddy lifting', remarks: 'Biggest farmer-grievance window — dates notified each year' },
  { slNo: 7,  occasion: 'Madai melas (Bastar & Kanker region)',                   date: 'January – March', monitoringRange: 'Season',        keywords: 'Madai, मड़ई, Bastar, Kanker, tribal fair',                  remarks: 'Tribal gatherings — dates vary' },
  { slNo: 8,  occasion: 'Rajim Kumbh Kalp',                                       date: 'February/March', monitoringRange: 'Magh Purnima – Mahashivratri', keywords: 'Rajim Kumbh, Rajim Kumbh Kalp, राजिम कुंभ, Triveni Sangam, sadhu', remarks: 'Large crowds, VVIP visits — date varies' },
  { slNo: 9,  occasion: 'Chief Minister Vishnu Deo Sai birthday',                  date: '21 February',  monitoringRange: '20 Feb – 22 Feb',  keywords: 'Vishnu Deo Sai birthday, जन्मदिन, CM Sai',               remarks: 'Client leadership' },
  { slNo: 10, occasion: 'Maha Shivaratri',                                        date: 'February/March', monitoringRange: '± 1 day',        keywords: 'Maha Shivaratri, Bhoramdev, Shiva, temple',               remarks: 'Date varies each year' },
  { slNo: 11, occasion: 'Chhattisgarh Legislative Assembly — Budget Session',     date: 'February – March', monitoringRange: 'Session duration', keywords: 'Vidhan Sabha, budget, OP Choudhary budget, walkout, question hour', remarks: 'Date varies each year' },
  { slNo: 12, occasion: 'Holi',                                                   date: 'March',        monitoringRange: '± 2 days',         keywords: 'Holi, फाग, Faag, colours',                                 remarks: 'Date varies each year' },
  { slNo: 13, occasion: 'Mahtari Vandan Yojana anniversary',                      date: '10 March',     monitoringRange: '9 Mar – 11 Mar',   keywords: 'Mahtari Vandan, महतारी वंदन, 1000 rupees, women',          remarks: 'Flagship scheme (launched 10 Mar 2024); instalments are credited monthly' },
  { slNo: 14, occasion: 'Bhoramdev Mahotsav, Kabirdham',                          date: 'March/April',  monitoringRange: 'Event duration',   keywords: 'Bhoramdev Mahotsav, Kawardha, Kabirdham',                 remarks: 'Date varies each year' },
  { slNo: 15, occasion: 'Chaitra Navratri (Dongargarh, Ratanpur, Danteshwari)',   date: 'March/April',  monitoringRange: '9 days',           keywords: 'Navratri, Maa Bamleshwari, Dongargarh, Ratanpur Mahamaya, Danteshwari, jyoti kalash', remarks: 'Pilgrim crowds — date varies' },
  { slNo: 16, occasion: 'Ram Navami',                                             date: 'March/April',  monitoringRange: '± 2 days',         keywords: 'Ram Navami, Chandkhuri, Kaushalya Mata, procession',      remarks: 'Date varies each year' },
  { slNo: 17, occasion: 'Ramzan / Eid-ul-Fitr',                                   date: 'March/April',  monitoringRange: '± 2 days',         keywords: 'Ramzan, Eid-ul-Fitr, Eid',                                remarks: 'Date varies each year' },
  { slNo: 18, occasion: 'Dr. B.R. Ambedkar Jayanti',                              date: '14 April',     monitoringRange: '13 Apr – 15 Apr',  keywords: 'Ambedkar Jayanti, reservation',                           remarks: '' },
  { slNo: 19, occasion: 'Tendu patta collection season',                          date: 'May',          monitoringRange: 'May – June',       keywords: 'tendu patta, तेंदूपत्ता, standard bora, collectors, bonus, van dhan', remarks: 'Tribal livelihood grievances' },
  { slNo: 20, occasion: 'Jheeram Ghati attack anniversary',                       date: '25 May',       monitoringRange: '24 May – 26 May',  keywords: 'Jheeram, झीरम घाटी, 2013, Naxal attack, Congress leaders, NIA', remarks: 'Congress commemorates — sensitive' },
  { slNo: 21, occasion: 'Anti-Naxal operations & encounters',                     date: 'All year',     monitoringRange: 'Continuous',        keywords: 'Naxal, नक्सल, encounter, IED, surrender, DRG, CRPF, Bijapur, Sukma, Narayanpur, Abujhmarh', remarks: 'Security — highest sensitivity' },
  { slNo: 22, occasion: 'Rath Yatra',                                             date: 'June/July',    monitoringRange: '± 1 day',          keywords: 'Rath Yatra, Jagannath, Raipur, Bastar Goncha',            remarks: 'Date varies each year' },
  { slNo: 23, occasion: 'Bakri Eid (Eid-ul-Adha)',                                date: 'June',         monitoringRange: '± 2 days',         keywords: 'Eid-ul-Adha, Bakrid',                                     remarks: 'Date varies each year' },
  { slNo: 24, occasion: 'Muharram',                                               date: 'June/July',    monitoringRange: '± 2 days',         keywords: 'Muharram, Ashura',                                        remarks: 'Date varies each year' },
  { slNo: 25, occasion: 'Chhattisgarh Legislative Assembly — Monsoon Session',    date: 'July',         monitoringRange: 'Session duration', keywords: 'Vidhan Sabha, monsoon session, question hour, adjournment motion', remarks: 'Date varies each year' },
  { slNo: 26, occasion: 'Monsoon — floods, roads, fertiliser supply',             date: 'June – September', monitoringRange: 'Whole season', keywords: 'flood, khaad, DAP, urea, road, potholes, power cut, dengue, malaria', remarks: 'Civic-grievance peak' },
  { slNo: 27, occasion: 'Hareli Tihar',                                           date: 'July/August',  monitoringRange: '± 1 day',          keywords: 'Hareli, हरेली, gedi, farmers, Shravan Amavasya',          remarks: "First festival of Chhattisgarh's farming year — date varies" },
  { slNo: 28, occasion: 'World Indigenous Peoples Day (Vishwa Adivasi Diwas)',     date: '9 August',     monitoringRange: '8 Aug – 10 Aug',   keywords: 'Vishwa Adivasi Diwas, आदिवासी दिवस, tribal rights, Sarva Adivasi Samaj', remarks: 'Tribal politics' },
  { slNo: 29, occasion: 'Independence Day',                                       date: '15 August',    monitoringRange: '13 Aug – 17 Aug',  keywords: 'Independence Day, 15 August, tricolour',                 remarks: 'High priority' },
  { slNo: 30, occasion: 'Pola & Teeja (Tija)',                                    date: 'August/September', monitoringRange: '± 2 days',     keywords: 'Pola, पोरा, Teeja, तीजा, bullocks, women, maika',          remarks: 'Major Chhattisgarhi festivals — date varies' },
  { slNo: 31, occasion: 'Ganesh Chaturthi & Chakradhar Samaroh, Raigarh',         date: 'August/September', monitoringRange: '10 days',      keywords: 'Ganesh Chaturthi, Chakradhar Samaroh, Raigarh, visarjan',  remarks: 'Date varies each year' },
  { slNo: 32, occasion: 'Karma festival',                                         date: 'August/September', monitoringRange: '± 2 days',     keywords: 'Karma, करमा, Karma Tihar, tribal dance',                  remarks: 'Date varies each year' },
  { slNo: 33, occasion: 'Bastar Dussehra (75 days)',                              date: 'July – October', monitoringRange: 'Festival duration', keywords: 'Bastar Dussehra, बस्तर दशहरा, Muria Darbar, Jagdalpur, Danteshwari', remarks: 'CM attends Muria Darbar — date varies' },
  { slNo: 34, occasion: 'Gandhi Jayanti',                                         date: '2 October',    monitoringRange: '1 Oct – 3 Oct',    keywords: 'Gandhi Jayanti, Mahatma Gandhi',                          remarks: '' },
  { slNo: 35, occasion: 'Sharad Navratri & Dussehra',                             date: 'September/October', monitoringRange: '10 days',     keywords: 'Navratri, Dussehra, Ravan dahan, Dongargarh, garba',      remarks: 'Date varies each year' },
  { slNo: 36, occasion: 'Bastar Olympics',                                        date: 'October – December', monitoringRange: 'Event duration', keywords: 'Bastar Olympics, बस्तर ओलंपिक, surrendered Naxals, sports', remarks: 'Government outreach in Bastar' },
  { slNo: 37, occasion: 'Diwali & Govardhan Puja',                                date: 'October/November', monitoringRange: '± 2 days',     keywords: 'Diwali, Govardhan Puja, Raut Nacha, firecrackers',        remarks: 'Date varies each year' },
  { slNo: 38, occasion: 'Chhattisgarh Rajyotsava (State Foundation Day)',         date: '1 November',   monitoringRange: '31 Oct – 5 Nov',   keywords: 'Rajyotsava, राज्योत्सव, 1 November, Chhattisgarh foundation day, Nava Raipur', remarks: 'High priority — state event' },
  { slNo: 39, occasion: 'Paddy procurement season opens',                         date: 'November',     monitoringRange: 'Opening week',     keywords: 'dhan kharidi, धान खरीदी, 3100, 21 quintal, token tunhar hath, samiti', remarks: 'Opening date notified each year' },
  { slNo: 40, occasion: 'Chhattisgarhi Rajbhasha Diwas',                          date: '28 November',  monitoringRange: '27 Nov – 29 Nov',  keywords: 'Chhattisgarhi Rajbhasha, छत्तीसगढ़ी राजभाषा, Chhattisgarhi language', remarks: 'Language & identity' },
  { slNo: 41, occasion: 'Babri demolition anniversary',                           date: '6 December',   monitoringRange: '5 Dec – 7 Dec',    keywords: 'Babri Masjid, anniversary',                               remarks: 'Sensitive date' },
  { slNo: 42, occasion: 'Shaheed Veer Narayan Singh Balidan Diwas',               date: '10 December',  monitoringRange: '9 Dec – 11 Dec',   keywords: 'Veer Narayan Singh, Sonakhan, 1857, balidan diwas',       remarks: "Chhattisgarh's first freedom-struggle martyr" },
  { slNo: 43, occasion: 'Sai government anniversary',                             date: '13 December',  monitoringRange: '12 Dec – 14 Dec',  keywords: 'Vishnu Deo Sai, government anniversary, sushasan, report card', remarks: 'Client leadership — sworn in 13 Dec 2023' },
  { slNo: 44, occasion: 'Chhattisgarh Legislative Assembly — Winter Session',     date: 'December',     monitoringRange: 'Session duration', keywords: 'Vidhan Sabha, winter session, supplementary budget',      remarks: 'Date varies each year' },
  { slNo: 45, occasion: 'Guru Ghasidas Jayanti',                                  date: '18 December',  monitoringRange: '17 Dec – 20 Dec',  keywords: 'Guru Ghasidas, Satnami, Giroudpuri, jaitkham, Satnam',    remarks: 'Satnami community — politically significant' },
  { slNo: 46, occasion: 'Christmas',                                              date: '25 December',  monitoringRange: '24 Dec – 26 Dec',  keywords: 'Christmas, Kunkuri cathedral, Jashpur, church, conversion', remarks: 'Conversion politics sensitive in Jashpur/Bastar' },
  { slNo: 47, occasion: 'Sushasan Diwas (Atal Bihari Vajpayee Jayanti)',           date: '25 December',  monitoringRange: '24 Dec – 26 Dec',  keywords: 'Sushasan Diwas, Atal Bihari Vajpayee, good governance, सुशासन', remarks: 'BJP observance' },
];

// Ensure recurring seed events exist in the DB (replaces old data with updated list)
const seedRecurringEvents = async () => {
  try {
    // Remove old seed data and re-insert the current seed list
    const existing = await MasterCalendarEvent.find({ isRecurring: true, createdBy: 'system' });
    const existingSlNos = new Set(existing.map(e => e.slNo));
    const seedSlNos = new Set(RECURRING_SEED.map(e => e.slNo));

    // Delete old system events whose slNo no longer exists in seed
    for (const evt of existing) {
      if (!seedSlNos.has(evt.slNo)) {
        await MasterCalendarEvent.deleteOne({ _id: evt._id });
      }
    }

    // Upsert all seed events
    for (const evt of RECURRING_SEED) {
      await MasterCalendarEvent.findOneAndUpdate(
        { isRecurring: true, slNo: evt.slNo },
        { $set: { ...evt, isRecurring: true, createdBy: 'system' } },
        { upsert: true, new: true }
      );
    }
    console.log(`[MasterCalendar] ${RECURRING_SEED.length} Chhattisgarh recurring events seeded`);
  } catch (err) {
    console.error('[MasterCalendar] Seed error:', err.message);
  }
};

// ── CRUD controllers ──────────────────────────────────────

const listEvents = async (req, res) => {
  try {
    const { recurring } = req.query;
    const query = {};
    if (recurring === 'true') query.isRecurring = true;
    else if (recurring === 'false') query.isRecurring = false;

    const events = await MasterCalendarEvent.find(query).sort({ slNo: 1, createdAt: -1 });
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createEvent = async (req, res) => {
  try {
    const { occasion, date, monitoringRange, keywords, remarks, isRecurring } = req.body;
    if (!occasion || !date) {
      return res.status(400).json({ message: 'Occasion and date are required' });
    }

    // Auto-assign slNo
    const maxDoc = await MasterCalendarEvent.findOne({ isRecurring: !!isRecurring })
      .sort({ slNo: -1 }).select('slNo').lean();
    const slNo = (maxDoc?.slNo || 0) + 1;

    const event = await MasterCalendarEvent.create({
      slNo,
      occasion,
      date,
      monitoringRange: monitoringRange || '',
      keywords: keywords || '',
      remarks: remarks || '',
      isRecurring: !!isRecurring,
      createdBy: req.user?.email || 'unknown'
    });

    res.status(201).json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const event = await MasterCalendarEvent.findOne({ id });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const allowedFields = ['occasion', 'date', 'monitoringRange', 'keywords', 'remarks'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) event[field] = updates[field];
    }
    await event.save();
    res.json(event);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await MasterCalendarEvent.findOne({ id });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    await MasterCalendarEvent.deleteOne({ id });
    res.json({ message: 'Event deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  seedRecurringEvents,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent
};
