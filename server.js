const express = require('express');
const mysql = require('mysql2');
require('dotenv').config();
const ExcelJS = require('exceljs');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const cors = require('cors');
const multer = require('multer');
const app = express();
app.use(express.json());
app.use(cors({

  origin: ['https://verbiolagerhaltung-int-8f8c45f9d475.herokuapp.com',
           'https://verbiolagerhaltung-ef43cc7c796a.herokuapp.com',
           'https://lagerhaltung.verbio-systeme.de',
           'https://devlagerhaltung.verbio-systeme.de'
  ]
}));
app.use(express.static('public'));

let Standort = '';
const storage = multer.memoryStorage(); // Verwende Memory Storage für Dateipuffer
const upload = multer({ storage: storage });

// Datenbankverbindung konfigurieren
let connection;

if (process.env.JAWSDB_URL) {
  // Wenn JAWSDB_URL vorhanden ist, verwenden Sie diese
  connection = mysql.createConnection(process.env.JAWSDB_URL);
} else {
  // Ansonsten verwenden Sie die lokalen Konfigurationsdaten
  connection = mysql.createConnection({
    host: process.env.MYSQL_HOST_LAGER,
    user: process.env.MYSQL_USER_LAGER,
    password: process.env.MYSQL_PASSWORD_LAGER,
    database: process.env.MYSQL_DATABASE_LAGER
  });
}
// Verbindung zur Datenbank herstellen
connection.connect((err) => {
  if (err) {
    console.error('Fehler bei der Verbindung zur Datenbank:', err);
    // Hier können Sie entscheiden, ob Sie die Anwendung beenden möchten
    // process.exit(1);
    return;
  }
  console.log('Mit der Datenbank verbunden');
});

// Datenbankverbindung inventure konfigurieren     INVENTUR INVENTUR
let inventurcon;

if (process.env.RDS_INVENTUR_URL) {
  inventurcon = mysql.createPool(process.env.RDS_INVENTUR_URL);
} else {
  inventurcon = mysql.createPool({
    host: process.env.MYSQL_HOST_INVENTUR,
    user: process.env.MYSQL_USER_INVENTUR,
    password: process.env.MYSQL_PASSWORD_INVENTUR,
    database: process.env.MYSQL_DATABASE_INVENTUR,
    port: process.env.MYSQL_PORT_INVENTUR,
    waitForConnections: true,
    connectionLimit: 10
  });
}





// Datenbank Dashboard
let dashboardcon;


if (process.env.JAWSDB_TEAL_URL) {
  dashboardcon = mysql.createConnection(process.env.JAWSDB_TEAL_URL);
} else {
  dashboardcon = mysql.createConnection({
    host: process.env.MYSQL_HOST_DASHBOARD,
    user: process.env.MYSQL_USER_DASHBOARD,
    password: process.env.MYSQL_PASSWORD_DASHBOARD,
    database: process.env.MYSQL_DATABASE_DASHBOARD
  });
}

dashboardcon.connect((err) => {

  if (err) {
    console.error('Fehler bei der Verbindung zur Datenbank:', err);
    return;
  }
  console.log('Mit der Datenbank verbunden');
});


// s3.config für Bilderxfn
const AWS = require('aws-sdk');

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: 'eu-north-1'
});
const s3 = new AWS.S3();




// Testen der S3 Verbindung
s3.listObjectsV2({ Bucket: 'verbio-lagerkatalog' }, (err, data) => {
  if (err) {
    console.error('Fehler bei der Verbindung zu S3. Anwendung wird beendet:', err);
    process.exit(1); // Anwendung beenden, wenn keine Verbindung zu S3 hergestellt werden kann
  } else {
    console.log('Verbindung zu S3 erfolgreich');
  }
});

// Funktion zum Hochladen eines Bildes auf S3
const uploadImageToS3 = (fileBuffer, fileName) => {
  const params = {
    Bucket: 'verbio-lagerkatalog',
    Key: fileName,
    Body: fileBuffer
  };

  return new Promise((resolve, reject) => {
    s3.upload(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data.Location); // URL des hochgeladenen Bildes
      }
    });
  });
};

// Route für die Einlagerung
app.post('/execute-query', (req, res) => {
  const { artikelnummer, artikelname, anzahl, bearbeiter, table, preis_stueck } = req.body;
  const query1 = `
  INSERT INTO nmnq9un4padignae.transferlager (Artikelnummer, Artikelname, Anzahl, Bearbeiter, \`Preis/Stück\`)
  VALUES (?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
  Anzahl = Anzahl - VALUES(Anzahl),
  Bearbeiter = VALUES(Bearbeiter),
   \`Preis/Stück\` = VALUES(\`Preis/Stück\`)
`;

const query2 = `
  INSERT INTO nmnq9un4padignae.\`${table}\` (Artikelnummer, Artikelname, Anzahl, Bearbeiter, \`Preis/Stück\`)
  VALUES (?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
  Anzahl = Anzahl + VALUES(Anzahl),
  Bearbeiter = VALUES(Bearbeiter),
  \`Preis/Stück\` = VALUES(\`Preis/Stück\`)
`;

  connection.beginTransaction((err) => {
    if (err) {
      console.error('Fehler beim Starten der Transaktion:', err);
      return res.status(500).json({ error: 'Fehler beim Starten der Transaktion' });
    }

    connection.query(query1, [artikelnummer, artikelname, anzahl, bearbeiter, preis_stueck], (err, results1) => {
      if (err) {
        return connection.rollback(() => {
          console.error('Fehler bei Query 1:', err);
          res.status(500).json({ error: 'Fehler beim Ausführen von Query 1' });
        });
      }

      connection.query(query2, [artikelnummer, artikelname, anzahl, bearbeiter, preis_stueck], (err, results2) => {
        if (err) {
          return connection.rollback(() => {
            console.error('Fehler bei Query 2:', err);
            res.status(500).json({ error: 'Fehler beim Ausführen von Query 2' });
          });
        }

        connection.commit((err) => {
          if (err) {
            return connection.rollback(() => {
              console.error('Fehler beim Commit der Transaktion:', err);
              res.status(500).json({ error: 'Fehler beim Abschließen der Transaktion' });
            });
          }
          res.status(200).json({ message: 'Artikel erfolgreich bearbeitet', id1: results1.insertId, id2: results2.insertId });
        });
      });
    });
  });
});

// Route für die popup
app.post('/popup-query', (req, res) => {
  const { artikelnummer, anzahl, table } = req.body;


  const query = `
  INSERT INTO yl8svp9xg3ps3ocg.${table} (Artikelnummer, Anzahl)
  VALUES (?, ?)
  ON DUPLICATE KEY UPDATE
  Anzahl = Anzahl + VALUES(Anzahl)
`;


  inventurcon.query(query, [artikelnummer, anzahl], (err, results) => {
    if (err) {
      console.error('Fehler:', err);
      return res.status(500).json({ error: 'Fehler beim Zählen des Artikels' });
    }
    res.status(200).json({ message: 'Artikel zählen erfolgreich', id: results.insertId });
    console.log('Ausgewählter Table aktuell ist: '+ table);
  });
});


// Route für die Auslagerung
app.post('/minus-query', (req, res) => {
  const { artikelnummer, artikelname, anzahl, bearbeiter, table, isOnline, preis_stueck } = req.body;

  const checkQuery = `SELECT Anzahl FROM nmnq9un4padignae.${table} WHERE Artikelnummer = ?`;

  const query1 = `
  INSERT INTO nmnq9un4padignae.${table} (Artikelnummer, Artikelname, Anzahl, Bearbeiter , \`Preis/Stück\`)
  VALUES (?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
  Anzahl = Anzahl - VALUES(Anzahl),
  Bearbeiter = VALUES(Bearbeiter),
  \`Preis/Stück\` = VALUES(\`Preis/Stück\`)
`;

const query2 = `
  INSERT INTO nmnq9un4padignae.transferlager (Artikelnummer, Artikelname, Anzahl, Bearbeiter, \`Preis/Stück\`)
  VALUES (?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
  Anzahl = Anzahl + VALUES(Anzahl),
  Bearbeiter = VALUES(Bearbeiter),
  \`Preis/Stück\` = VALUES(\`Preis/Stück\`)
`;

  connection.beginTransaction((err) => {
    if (err) {
      console.error('Fehler beim Starten der Transaktion:', err);
      return res.status(500).json({ error: 'Fehler beim Starten der Transaktion' });
    }

    // Schritt 1: Bestand prüfen (nur wenn isOnline true ist)
    if (isOnline) {
      connection.query(checkQuery, [artikelnummer], (err, results) => {
        if (err) {
          return connection.rollback(() => {
            console.error('Fehler beim Prüfen des Bestands:', err);
            res.status(500).json({ error: 'Fehler beim Abrufen des Bestands' });
          });
        }

        if (results.length === 0) {
          return connection.rollback(() => {
            console.error('Artikel nicht gefunden:', artikelnummer);
            res.status(404).json({ error: 'Artikel nicht gefunden' });
          });
        }

        if (results[0].Anzahl < anzahl) {
          return connection.rollback(() => {
            console.error('Nicht genügend Bestand für Artikel:', artikelnummer);
            res.status(400).json({ error: `Nicht genügend Bestand vorhanden (${results[0].Anzahl} verfügbar, ${anzahl} benötigt)` });
          });
        }

        executeMainQueries();
      });
    } else {
      executeMainQueries();
    }

    function executeMainQueries() {
      // Schritt 2: Artikel im Lager reduzieren
      connection.query(query1, [artikelnummer, artikelname, anzahl, bearbeiter, preis_stueck], (err, results1) => {
        if (err) {
          return connection.rollback(() => {
            console.error('Fehler bei der Bestandsreduzierung:', err);
            res.status(500).json({ error: 'Fehler beim Reduzieren des Bestands' });
          });
        }

        // Schritt 3: Artikel ins Transferlager hinzufügen
        connection.query(query2, [artikelnummer, artikelname, anzahl, bearbeiter, preis_stueck], (err, results2) => {
          if (err) {
            return connection.rollback(() => {
              console.error('Fehler beim Einfügen ins Transferlager:', err);
              res.status(500).json({ error: 'Fehler beim Einfügen in das Transferlager' });
            });
          }

          // Schritt 4: Transaktion abschließen
          connection.commit((err) => {
            if (err) {
              return connection.rollback(() => {
                console.error('Fehler beim Commit:', err);
                res.status(500).json({ error: 'Fehler beim Abschließen der Transaktion' });
              });
            }
            res.status(200).json({ 
              message: 'Artikel erfolgreich bearbeitet', 
              id1: results1.insertId, 
              id2: results2.insertId 
            });
          });
        });
      });
    }
  });
});

// Route für das Dashboard
app.post('/dashboard', (req, res) => {
  const { Artikelnummer, Artikelname, Standort, selectedSaule, AktionCount } = req.body;
console.log(req.body)
  // 1. Prüfen, ob Eintrag mit allen drei Kriterien existiert
  const checkQuery = `
    SELECT id, AktionCount 
    FROM dashboard 
    WHERE 
      Artikelnummer = ? AND 
      Standort = ? AND 
      selectedSaule = ?
  `;

  dashboardcon.query(checkQuery, [Artikelnummer, Standort, selectedSaule], (checkErr, checkResults) => {
    if (checkErr) {
      console.error('Fehler bei der Überprüfung:', checkErr);
      return res.status(500).json({ error: 'Datenbankabfrage fehlgeschlagen' });
    }

    const aktionCountInt = AktionCount ? parseInt(AktionCount, 10) : 0;

    if (checkResults.length > 0) {
      // 2a. Update bestehender Eintrag (alle drei Werte gleich)
      const updateQuery = `
        UPDATE dashboard 
        SET 
          AktionCount = AktionCount + ?,
          Artikelname = ?
        WHERE 
          Artikelnummer = ? AND 
          Standort = ? AND 
          selectedSaule = ?
      `;
      
      dashboardcon.query(updateQuery, 
        [aktionCountInt, Artikelname, Artikelnummer, Standort, selectedSaule],
        (updateErr, updateResults) => {
          if (updateErr) {
            console.error('Update-Fehler:', updateErr);
            return res.status(500).json({ error: 'Update fehlgeschlagen' });
          }
          res.status(200).json({
            message: 'Eintrag aktualisiert',
            matchedCriteria: { Artikelnummer, Standort, selectedSaule }
          });
        });
    } else {
      // 2b. Neuer Eintrag (mindestens ein Wert der drei Kriterien unterschiedlich)
      const insertQuery = `
        INSERT INTO dashboard 
        (Artikelnummer, Artikelname, Standort, selectedSaule, AktionCount)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      dashboardcon.query(insertQuery, 
        [Artikelnummer, Artikelname, Standort, selectedSaule, aktionCountInt],
        (insertErr, insertResults) => {
          if (insertErr) {
            console.error('Insert-Fehler:', insertErr);
            return res.status(500).json({ error: 'Erstellung fehlgeschlagen' });
          }
          res.status(200).json({
            message: 'Neuer Eintrag erstellt',
            id: insertResults.insertId,
            criteria: { Artikelnummer, Standort, selectedSaule }
          });
        });
    }
  });
});

// Route für das Hinzufügen eines neuen Lagers
// Route für das Hinzufügen eines neuen Lagers
app.post('/storage', (req, res) => {
  const { lagername } = req.body;
  
  // SQL-Query zur Erstellung der neuen Tabelle
  const storageQuery = `
  CREATE TABLE \`${lagername}\` AS
  SELECT 
    \`Artikelnummer\`,
    \`Artikelname\`,
    NULL AS \`Anzahl\`,
    \`Bearbeiter\`,
    \`QRCode\`,
    \`Preis/Stück\`,
    \`Wert/Gesamt\`,
    \`Bild\`
  FROM 
    \`amt_wachsenburg\`;
  `;

  // Ausführen der Query
  connection.query(storageQuery, (error, results) => {
    if (error) {
      console.error('Fehler beim Hinzufügen des neuen Lagers:', error);
      res.status(500).json({
        message: 'Fehler beim Hinzufügen des neuen Lagers',
        error: error.message
      });
    } else {
      console.log('Neues Lager hinzugefügt:', lagername);
      res.status(201).json({
        message: 'Neues Lager erfolgreich hinzugefügt',
        lagername: lagername
      });
    }
  });
});

// Route zum Abrufen aller Tabellennamen
app.get('/tables', (req, res) => {
  connection.query("SHOW TABLES", (err, results) => {
    if (err) {
      console.error('Fehler beim Abrufen der Tabellennamen:', err);
      return res.status(500).json({ error: 'Fehler beim Abrufen der Tabellennamen' });
    }
    res.json(results.map(row => Object.values(row)[0])); // Nur Tabellennamen zurückgeben
  });
});

// Route zum Abrufen von Daten aus einer bestimmten Tabelle
app.get('/data/:tableName', (req, res) => {
  const tableName = req.params.tableName;
  Standort = tableName;
  connection.query(`SELECT * FROM ??`, [tableName], (err, results) => {
    if (err) {
      console.error('Fehler beim Abrufen der Daten:', err);
      return res.status(500).json({ error: 'Daten konnten nicht abgerufen werden.' });
    }
    res.json(results);
  });
});

// Route für das Dashboard (Verbrauchsdaten)
app.get('/dashboard-data', (req, res) => {
  const location = req.query.location;

  console.log('Mal wieder der location mist: ' + location);

  if (!location) {
    return res.status(400).json({ error: 'Standort ist erforderlich' });
  }

  const query = `SELECT * FROM dashboard WHERE Standort = ?`;

  dashboardcon.query(query, [location], (err, results) => {
    if (err) {
      console.error('Datenbankfehler:', err);
      return res.status(500).json({
        error: 'Datenbankfehler',
        message: err.message
      });
    }

    res.json(results);
  });
});

app.post('/createinventur', (req, res) => {
  const { inventurname, standort, erstellungsdatum, verantwortlicher, passwort, faelligkeitsdatum, anzahl, artikelnummer } = req.body;

  // Bereinigen des Inventurnamens, um einen gültigen Tabellennamen zu erstellen
  const bereinigterInventurname = inventurname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');

  const erstelleTabelleQuery = `
  CREATE TABLE IF NOT EXISTS \`yl8svp9xg3ps3ocg\`.\`${bereinigterInventurname}\` (
    Inventurname VARCHAR(100) NOT NULL,
    Standort VARCHAR(100) NOT NULL,
    Erstellungsdatum DATE NOT NULL,
    Verantwortlicher VARCHAR(100) NOT NULL,
    Passwort VARCHAR(45) NOT NULL,
    Faelligkeitsdatum DATE NOT NULL,
    Anzahl INT,
    Artikelnummer VARCHAR(100),
    PRIMARY KEY (Artikelnummer)
  );
`;

  const fuegeDataEinQuery = `
    INSERT INTO \`yl8svp9xg3ps3ocg\`.\`${bereinigterInventurname}\` 
    (Inventurname, Standort, Erstellungsdatum, Verantwortlicher, Passwort, Faelligkeitsdatum, Artikelnummer, Anzahl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
    Inventurname = VALUES(Inventurname),
    Standort = VALUES(Standort),
    Erstellungsdatum = VALUES(Erstellungsdatum),
    Verantwortlicher = VALUES(Verantwortlicher),
    Passwort = VALUES(Passwort),
    Faelligkeitsdatum = VALUES(Faelligkeitsdatum),
    Anzahl = Anzahl + VALUES(Anzahl)
  `;

  // Verwenden Sie '0' als Standardwert, wenn keine Artikelnummer angegeben ist
  const artikelnummerWert = artikelnummer || '0';
  const anzahlWert = anzahl || 0; // Setze Anzahl auf 0, wenn nicht angegeben

  inventurcon.query(erstelleTabelleQuery, (err, results) => {
    if (err) {
      console.error('Fehler beim Erstellen der Tabelle:', err);
      return res.status(500).json({ error: 'Fehler beim Erstellen der Tabelle' });
    }

    inventurcon.query(fuegeDataEinQuery, [inventurname, standort, erstellungsdatum, verantwortlicher, passwort, faelligkeitsdatum, artikelnummerWert, anzahlWert], (err, results) => {
      if (err) {
        console.error('Fehler beim Einfügen der Daten:', err);
        return res.status(500).json({ error: 'Fehler beim Einfügen der Daten' });
      }
      res.status(200).json({ message: 'Tabelle erfolgreich erstellt und Daten eingefügt' });
    });
  });
});

app.post('/insert-article', upload.single('bild'), async (req, res) => {
  try {
    const { artikelnummer, artikelname, anzahl, bearbeiter, qrCode, preis_stueck } = req.body;
    const file = req.file;
    let imageUrl = 'https://www.leitern-himmelsbach.de/images/product_images/original_images/kein-bild.jpg';

    console.log('Daten im Request:', req.body);
    console.log('Bild im Request:', file);

    // Wenn Bild vorhanden und gültig, hochladen
    if (file && file.buffer && file.buffer.length > 0) {
      const fileName = req.body.bildName || `${artikelnummer}_${Date.now()}.jpg`;
      imageUrl = await uploadImageToS3(file.buffer, fileName);
    }

    // S3-Test (optional)
    s3.listObjectsV2({ Bucket: 'verbio-lagerkatalog' }, (err, data) => {
      if (err) {
        console.error('Fehler bei der Verbindung zu S3:', err);
      } else {
        console.log('Verbindung zu S3 erfolgreich:', data.Contents);
      }
    });

    // Tabellen abrufen
    const getTablesQuery = "SHOW TABLES FROM nmnq9un4padignae";
    connection.query(getTablesQuery, (err, tables) => {
      if (err) {
        console.error('Fehler beim Abrufen der Tabellennamen:', err);
        return res.status(500).json({ error: 'Fehler beim Einfügen des Artikels' });
      }

      const tableNames = tables
      .map(table => table[`Tables_in_nmnq9un4padignae`])
      .filter(name => name !== 'mhdartikel');

      const insertPromises = tableNames.map(tableName => {
        return new Promise((resolve, reject) => {
          const insertQuery = `
            INSERT INTO nmnq9un4padignae.\`${tableName}\` 
            (Artikelnummer, Artikelname, Anzahl, Bearbeiter, QRCode, Bild, \`Preis/Stück\`) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              Anzahl = VALUES(Anzahl),
              Bearbeiter = VALUES(Bearbeiter),
              QRCode = VALUES(QRCode),
              Bild = VALUES(Bild),
              \`Preis/Stück\` = VALUES(\`Preis/Stück\`)
          `;

          connection.query(insertQuery, [
            artikelnummer,
            artikelname,
            anzahl,
            bearbeiter,
            qrCode,
            imageUrl,
            preis_stueck
          ], (err, results) => {
            if (err) {
              reject(err);
            } else {
              resolve(results);
            }
          });
        });
      });

      Promise.all(insertPromises)
        .then(() => {
          res.status(200).json({ message: 'Artikel erfolgreich in alle Tabellen eingefügt' });
        })
        .catch(err => {
          console.error('Fehler beim Einfügen in einige Tabellen:', err);
          res.status(500).json({ error: 'Fehler beim Einfügen des Artikels in einige Tabellen' });
        });
    });
  } catch (error) {
    console.error('Fehler beim Hochladen oder Einfügen:', error);
    res.status(500).json({ error: 'Fehler beim Hochladen oder Einfügen' });
  }
});


// Route zum Abrufen der Bild-URL
app.get('/get-image-url/:artikelnummer', async (req, res) => {
  const artikelnummer = req.params.artikelnummer;
  const params = {
    Bucket: 'verbio-lagerkatalog',
    Prefix: artikelnummer // Optional, um Bilder nach Artikelnummer zu filtern
  };

  s3.listObjectsV2(params, (err, data) => {
    if (err) {
      console.error('Fehler beim Abrufen der Bild-URL:', err);
      return res.status(500).json({ error: 'Fehler beim Abrufen der Bild-URL' });
    }

    // Hier müssen Sie die Artikelnummer aus dem Dateinamen extrahieren
    const imageUrl = data.Contents.find(item => {
      const fileName = item.Key;
      const artikelnummerInFileName = fileName.split('_')[0];
      return artikelnummerInFileName === artikelnummer;
    });

    if (imageUrl) {
      const fullImageUrl = `https://${params.Bucket}.s3.${AWS.config.region}.amazonaws.com/${imageUrl.Key}`;
      res.json({ imageUrl: fullImageUrl });
    } else {
      res.json({ imageUrl: null });
    }
  });
});


///// Route zum entfernen eines Artikel in alle Lager//////////
app.delete('/delete-article/:artikelnummer', (req, res) => {
  const artikelnummer = req.params.artikelnummer;

  const getTablesQuery = "SHOW TABLES FROM nmnq9un4padignae";

  connection.query(getTablesQuery, (err, tables) => {
    if (err) {
      console.error('Fehler beim Abrufen der Tabellennamen:', err);
      return res.status(500).json({ error: 'Fehler beim Löschen des Artikels' });
    }

    const tableNames = tables.map(table => table[`Tables_in_nmnq9un4padignae`]);

    const deletePromises = tableNames.map(tableName => {
      return new Promise((resolve, reject) => {
        const deleteQuery = `
          DELETE FROM nmnq9un4padignae.\`${tableName}\`
          WHERE Artikelnummer = ?
        `;

        connection.query(deleteQuery, [artikelnummer], (err, results) => {
          if (err) {
            reject(err);
          } else {
            resolve(results);
          }
        });
      });
    });

    Promise.all(deletePromises)
      .then(() => {
        res.status(200).json({ message: 'Artikel erfolgreich aus allen Tabellen gelöscht' });
      })
      .catch(err => {
        console.error('Fehler beim Löschen aus einigen Tabellen:', err);
        console.error('Vollständiger Fehlerobjekt:', err);
        res.status(500).json({ error: 'Fehler beim Löschen des Artikels aus einigen Tabellen' });
      });
  });
});

// Route zum Abrufen aller Tabellennamen aus Inventur
app.get('/inventur', (req, res) => {
  inventurcon.query("SHOW TABLES", (err, results) => {
    if (err) {
      console.error('Fehler beim Abrufen der Tabellennamen:', err);
      return res.status(500).json({ error: 'Fehler beim Abrufen der Tabellennamen' });
    }
    res.json(results.map(row => Object.values(row)[0])); // Nur Tabellennamen zurückgeben
  });
});

// Route zum Abrufen von Daten aus einer bestimmten Tabelle
app.get('/inventur/:tableName', (req, res) => {
  const tableName = req.params.tableName;

  inventurcon.query(`SELECT * FROM ??`, [tableName], (err, results) => {
    if (err) {
      console.error('Fehler beim Abrufen der Daten:', err);
      return res.status(500).json({ error: 'Daten konnten nicht abgerufen werden.' });
    }
    res.json(results);
  });
});


// Route um IndexedDB zu aktualisieren
app.post('/api/sync', async (req, res) => {
  try {
    const locationDB = req.query.location; // Lesen des location-Parameters aus der Query
    
    if (!locationDB) {
      return res.status(400).json({ error: 'Location parameter is required' });
    }

    console.log('Aktuell gesendeter location vom Frontend: ', locationDB);
    
    const [rows] = await connection.promise().query('SELECT * FROM nmnq9un4padignae.??', [locationDB]);
    res.json(rows);
  } catch (error) {
    console.error('Fehler beim Abrufen der Daten:', error);
    res.status(500).json({ error: 'Fehler beim Abrufen der Daten' });
  }
});


// Neue Route zum Aktualisieren von Daten in der bestand Tabelle
app.post('/update/:tableName', (req, res) => {
  const tableName = req.params.tableName;
  const updatedData = req.body;

  if (!Array.isArray(updatedData) || updatedData.length === 0) {
    return res.status(400).json({ error: 'Ungültige Daten' });
  }

  // Erstellen Sie ein Array von Promises für jede Aktualisierung
  const updatePromises = updatedData.map(item => {
    return new Promise((resolve, reject) => {
       // Entfernen Sie 'Wert/Gesamt' aus dem item-Objekt
      const { ['Wert/Gesamt']: omitted, ...updateItem } = item;
      const query = `UPDATE ?? SET ? WHERE Artikelnummer = ?`;
      connection.query(query, [tableName, updateItem, updateItem.Artikelnummer], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  });

  // Führen Sie alle Aktualisierungen durch
  Promise.all(updatePromises)
    .then(() => {
      res.json({ message: 'Daten erfolgreich aktualisiert' });
    })
    .catch(error => {
      console.error('Fehler beim Aktualisieren der Daten:', error);
      console.error('Vollständiger Fehlerobjekt:', err);
      res.status(500).json({ error: 'Fehler beim Aktualisieren der Daten' });
    });
});


// Neue Route zum Aktualisieren von Daten in der Inventur Tabelle

app.post('/update/inventur/:tableName', (req, res) => {
  const tableName = req.params.tableName;
  const updatedData = req.body;

  if (!Array.isArray(updatedData) || updatedData.length === 0) {
    return res.status(400).json({ error: 'Ungültige Daten' });
  }

  // Erstellen Sie ein Array von Promises für jede Aktualisierung
  const updatePromises = updatedData.map(item => {
    return new Promise((resolve, reject) => {
      const query = `UPDATE ?? SET ? WHERE Artikelnummer = ?`;
      inventurcon.query(query, [tableName, item, item.Artikelnummer], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  });

  // Führen Sie alle Aktualisierungen durch
  Promise.all(updatePromises)
    .then(() => {
      res.json({ message: 'Daten erfolgreich aktualisiert' });
    })
    .catch(error => {
      console.error('Fehler beim Aktualisieren der Daten:', error);
      console.error('Vollständiger Fehlerobjekt:', err);
      res.status(500).json({ error: 'Fehler beim Aktualisieren der Daten' });
    });
});


// Route zum Überschreiben der Serverdaten mit IndexedDB-Daten
app.post('/api/overwrite', (req, res) => {
  // Extrahiere `artikelArray` und `location` aus dem Request-Body
  const { artikel: artikelArray, location } = req.body;
  const location1 = location;  
  // Optional: Logge die Location zur Überprüfung
  //console.log('Location:', tableName);
  console.log('Location vom Backend:', location);

  // Überprüfe, ob `artikelArray` ein gültiges Array ist
  if (!Array.isArray(artikelArray) || artikelArray.length === 0) {
    return res.status(400).json({ success: false, message: 'Ungültige Daten empfangen' });
  }

  // Transaktion starten
  connection.beginTransaction((err) => {
    if (err) {
      console.error('Fehler beim Starten der Transaktion:', err);
      return res.status(500).json({ success: false, message: 'Interner Serverfehler' });
    }
     
    // Zuerst alle vorhandenen Daten löschen
     //connection.query('DELETE FROM nmnq9un4padignae.lager', (deleteErr) => {
      connection.query(`DELETE FROM nmnq9un4padignae.??`, [location1], (deleteErr) => {
      if (deleteErr) {
        return connection.rollback(() => {
          console.error('Fehler beim Löschen der Daten:', deleteErr);
          res.status(500).json({ success: false, message: 'Fehler beim Löschen der vorhandenen Daten' });
        });
      }
 
      // Dann die neuen Daten einfügen
      //const insertQuery = 'INSERT INTO nmnq9un4padignae.lager (Artikelnummer, Artikelname, Anzahl, Bearbeiter) VALUES ?';
      const insertQuery = `INSERT INTO nmnq9un4padignae.\`${location1}\` (Artikelnummer, Artikelname, Anzahl, Bearbeiter, \`Preis/Stück\`) VALUES ?`;
      const values = artikelArray.map(artikel => [
        artikel.Artikelnummer,
        artikel.Artikelname,
        artikel.Anzahl,
        artikel.Bearbeiter,
        artikel['Preis/Stück']
      ]);

      connection.query(insertQuery, [values], (insertErr) => {
        if (insertErr) {
          return connection.rollback(() => {
            console.error('Fehler beim Einfügen der Daten:', insertErr);
            res.status(500).json({ success: false, message: 'Fehler beim Einfügen der neuen Daten' });
          });
        }

        // Transaktion abschließen
        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              console.error('Fehler beim Commit der Transaktion:', commitErr);
              res.status(500).json({ success: false, message: 'Fehler beim Abschließen der Transaktion' });
            });
          }
          res.status(200).json({ success: true, message: 'Daten erfolgreich überschrieben' });
        });
      });
    });
  });
});


// Route zum Überschreiben der MHD Serverdaten mit IndexedDB-Daten
app.post('/api/overwriteMHD', (req, res) => {
  const { artikel, location } = req.body;

  if (!Array.isArray(artikel) || artikel.length === 0 || !location) {
    return res.status(400).json({ success: false, message: 'Ungültige Daten empfangen' });
  }

  connection.beginTransaction(async (err) => {
    if (err) {
      console.error('Fehler beim Starten der Transaktion:', err);
      return res.status(500).json({ success: false, message: 'Interner Serverfehler' });
    }

    try {
      for (const item of artikel) {
        // Nur Artikel mit Anzahl > 0 verarbeiten
        const anzahl = item.Anzahl ? parseInt(item.Anzahl, 10) : 0;
        if (anzahl === 0) continue;

        const insertQuery = `
          INSERT INTO mhdArtikel (Artikelnummer, Artikelname, Standort, kennung, mhd)
          VALUES (?, ?, ?, ?, ?)
        `;

        await new Promise((resolve, reject) => {
          connection.query(
            insertQuery,
            [
              item.Artikelnummer,
              item.Artikelname,
              location,
              item.kennung || '',
              item.mhd || null
            ],
            (err) => err ? reject(err) : resolve()
          );
        });
      }

      connection.commit((err) => {
        if (err) {
          connection.rollback(() => {
            console.error('Fehler beim Commit:', err);
            return res.status(500).json({ success: false, message: 'Fehler beim Commit' });
          });
        } else {
          return res.status(200).json({ success: true, message: 'MHD erfolgreich gespeichert' });
        }
      });
    } catch (err) {
      connection.rollback(() => {
        console.error('Fehler während der Verarbeitung:', err);
        return res.status(500).json({ success: false, message: 'Interner Fehler bei der Verarbeitung' });
      });
    }
  });
});

// Route zum Überschreiben der MHD Serverdaten mit Online daten
app.post('/execute-queryMHD', (req, res) => {
  const { artikel, location } = req.body;

  if (!Array.isArray(artikel) || artikel.length === 0 || !location) {
    return res.status(400).json({ success: false, message: 'Ungültige Daten empfangen' });
  }

  connection.beginTransaction(async (err) => {
    if (err) {
      console.error('Fehler beim Starten der Transaktion:', err);
      return res.status(500).json({ success: false, message: 'Interner Serverfehler' });
    }

    try {
      for (const item of artikel) {
        // Nur Artikel mit Anzahl > 0 verarbeiten
        const anzahl = item.Anzahl ? parseInt(item.Anzahl, 10) : 0;
        if (anzahl === 0) continue;

        const insertQuery = `
          INSERT INTO mhdArtikel (Artikelnummer, Artikelname, Standort, kennung, mhd)
          VALUES (?, ?, ?, ?, ?)
        `;

        await new Promise((resolve, reject) => {
          connection.query(
            insertQuery,
            [
              item.Artikelnummer,
              item.Artikelname,
              location,
              item.kennung || '',
              item.mhd || null
            ],
            (err) => err ? reject(err) : resolve()
          );
        });
      }

      connection.commit((err) => {
        if (err) {
          connection.rollback(() => {
            console.error('Fehler beim Commit:', err);
            return res.status(500).json({ success: false, message: 'Fehler beim Commit' });
          });
        } else {
          return res.status(200).json({ success: true, message: 'MHD erfolgreich gespeichert' });
        }
      });
    } catch (err) {
      connection.rollback(() => {
        console.error('Fehler während der Verarbeitung:', err);
        return res.status(500).json({ success: false, message: 'Interner Fehler bei der Verarbeitung' });
      });
    }
  });
});


// Route zum löschen aus der MHD Serverdaten mit IndexedDB-Daten
app.post('/api/deleteMHD', (req, res) => {
  const { artikel } = req.body;

  if (!Array.isArray(artikel) || artikel.length === 0) {
    return res.status(400).json({ success: false, message: 'Ungültige Daten empfangen' });
  }

  connection.beginTransaction(async (err) => {
    if (err) {
      console.error('Fehler beim Starten der Transaktion:', err);
      return res.status(500).json({ success: false, message: 'Interner Serverfehler beim Start' });
    }

    try {
      for (const item of artikel) {
        const kennung = item.kennung;
        const abzug = item.abzug;

        // ⛔️ Wenn kein abzug oder abzug === 0 → überspringen
        if (!kennung || !abzug || abzug === 0) continue;

        const deleteQuery = `
          DELETE FROM mhdArtikel 
          WHERE kennung = ?
        `;

        await new Promise((resolve, reject) => {
          connection.query(deleteQuery, [kennung], (err, result) => {
            if (err) return reject(err);
            resolve(result);
          });
        });
      }

      connection.commit((err) => {
        if (err) {
          return connection.rollback(() => {
            console.error('Fehler beim Commit:', err);
            res.status(500).json({ success: false, message: 'Fehler beim Commit der Lösch-Transaktion' });
          });
        }

        return res.status(200).json({ success: true, message: 'MHD-Einträge erfolgreich gelöscht (mit abzug ≠ 0)' });
      });
    } catch (err) {
      connection.rollback(() => {
        console.error('Fehler während der Verarbeitung:', err);
        return res.status(500).json({ success: false, message: 'Fehler beim Löschen', detail: err.message });
      });
    }
  });
});

// Route zum löschen aus der MHD Serverdaten mit online daten
app.post('/minus-queryMHD', (req, res) => {
  const { artikel } = req.body;

  if (!Array.isArray(artikel) || artikel.length === 0) {
    return res.status(400).json({ success: false, message: 'Ungültige Daten empfangen' });
  }

  connection.beginTransaction(async (err) => {
    if (err) {
      console.error('Fehler beim Starten der Transaktion:', err);
      return res.status(500).json({ success: false, message: 'Interner Serverfehler beim Start' });
    }

    try {
      for (const item of artikel) {
        const kennung = item.kennung;
        const abzug = item.abzug;

        // ⛔️ Wenn kein abzug oder abzug === 0 → überspringen
        if (!kennung || !abzug || abzug === 0) continue;

        const deleteQuery = `
          DELETE FROM mhdArtikel 
          WHERE kennung = ?
        `;

        await new Promise((resolve, reject) => {
          connection.query(deleteQuery, [kennung], (err, result) => {
            if (err) return reject(err);
            resolve(result);
          });
        });
      }

      connection.commit((err) => {
        if (err) {
          return connection.rollback(() => {
            console.error('Fehler beim Commit:', err);
            res.status(500).json({ success: false, message: 'Fehler beim Commit der Lösch-Transaktion' });
          });
        }

        return res.status(200).json({ success: true, message: 'MHD-Einträge erfolgreich gelöscht (mit abzug ≠ 0)' });
      });
    } catch (err) {
      connection.rollback(() => {
        console.error('Fehler während der Verarbeitung:', err);
        return res.status(500).json({ success: false, message: 'Fehler beim Löschen', detail: err.message });
      });
    }
  });
});

////// Serverdaten von indexeddb Transferlager überschreiben 
app.post('/api/overwriteTransferlager', (req, res) => {
  const { artikel: artikelArray } = req.body;
  const tableName = 'transferlager'; // Fester Tabellenname

  console.log('Überschreibe Tabelle:', tableName);

  if (!Array.isArray(artikelArray) || artikelArray.length === 0) {
    return res.status(400).json({ success: false, message: 'Ungültige Daten empfangen' });
  }

  connection.beginTransaction((err) => {
    if (err) {
      console.error('Fehler beim Starten der Transaktion:', err);
      return res.status(500).json({ success: false, message: 'Interner Serverfehler' });
    }

    // 1. Tabelle leeren
    connection.query(`DELETE FROM nmnq9un4padignae.??`, [tableName], (deleteErr) => {
      if (deleteErr) {
        return connection.rollback(() => {
          console.error('Fehler beim Löschen der Daten:', deleteErr);
          res.status(500).json({ success: false, message: 'Fehler beim Löschen der Transferlagerdaten' });
        });
      }

      // 2. Neue Daten einfügen (nur existierende Felder)
      const insertQuery = `
        INSERT INTO nmnq9un4padignae.\`${tableName}\`
        (Artikelnummer, Artikelname, Anzahl, Bearbeiter, \`Preis/Stück\`)
        VALUES ?
      `;

      const values = artikelArray.map(artikel => [
        artikel.Artikelnummer,
        artikel.Artikelname,
        artikel.Anzahl,
        artikel.Bearbeiter,
        artikel['Preis/Stück'] || null
      ]);

      connection.query(insertQuery, [values], (insertErr) => {
        if (insertErr) {
          return connection.rollback(() => {
            console.error('Fehler beim Einfügen der Daten:', insertErr);
            res.status(500).json({ success: false, message: 'Fehler beim Einfügen der Daten in das Transferlager' });
          });
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              console.error('Fehler beim Commit:', commitErr);
              res.status(500).json({ success: false, message: 'Fehler beim Abschließen der Transaktion' });
            });
          }

          res.status(200).json({ success: true, message: 'Transferlager erfolgreich überschrieben' });
        });
      });
    });
  });
});

app.post('/api/overwriteDashboard', (req, res) => {
  const { artikel, location } = req.body;

  if (!Array.isArray(artikel) || artikel.length === 0 || !location) {
    return res.status(400).json({ success: false, message: 'Ungültige Daten empfangen' });
  }

  dashboardcon.beginTransaction(async (err) => {
    if (err) {
      console.error('Fehler beim Starten der Transaktion:', err);
      return res.status(500).json({ success: false, message: 'Interner Serverfehler' });
    }

    try {
      for (const item of artikel) {
        // Filterung: Nur Einträge mit AktionCount ≠ 0 verarbeiten
        const aktionCountInt = item.AktionCount ? parseInt(item.AktionCount, 10) : 0;
        if (aktionCountInt === 0) {
         // console.log(`Überspringe Artikel ${item.Artikelnummer} mit AktionCount 0`);
          continue;
        }

        // 1. Prüfung auf vorhandenen Eintrag
        const checkQuery = `
          SELECT id 
          FROM dashboard 
          WHERE 
            Artikelnummer = ? AND 
            Standort = ? AND 
            selectedSaule = ?
        `;

        const checkResults = await new Promise((resolve, reject) => {
          dashboardcon.query(
            checkQuery,
            [item.Artikelnummer, location, item.selectedSaule],
            (err, results) => err ? reject(err) : resolve(results)
          );
        });

        // 2a. Update bestehender Eintrag
        if (checkResults.length > 0) {
          await new Promise((resolve, reject) => {
            const updateQuery = `
              UPDATE dashboard 
              SET 
                AktionCount = AktionCount + ?,
                Artikelname = ?
              WHERE 
                Artikelnummer = ? AND 
                Standort = ? AND 
                selectedSaule = ?
            `;
            
            dashboardcon.query(
              updateQuery,
              [aktionCountInt, item.Artikelname, item.Artikelnummer, location, item.selectedSaule],
              (err) => err ? reject(err) : resolve()
            );
          });
        } 
        // 2b. Neuer Eintrag
        else {
          await new Promise((resolve, reject) => {
            const insertQuery = `
              INSERT INTO dashboard 
              (Artikelnummer, Artikelname, Standort, selectedSaule, AktionCount)
              VALUES (?, ?, ?, ?, ?)
            `;
            
            dashboardcon.query(
              insertQuery,
              [item.Artikelnummer, item.Artikelname, location, item.selectedSaule, aktionCountInt],
              (err) => err ? reject(err) : resolve()
            );
          });
        }
      }

      // Transaktion erfolgreich abschließen
      await new Promise((resolve, reject) => {
        dashboardcon.commit((err) => err ? reject(err) : resolve());
      });

      res.status(200).json({ 
        success: true, 
        message: 'Daten erfolgreich synchronisiert',
        info: 'Nur Einträge mit AktionCount ≠ 0 wurden verarbeitet'
      });

    } catch (error) {
      // Rollback bei Fehlern
      await new Promise((resolve) => dashboardcon.rollback(() => resolve()));
      console.error('Fehler:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Verarbeitungsfehler',
        detail: error.message
      });
    }
  });
});


///////////Update Preis in allen Tables
app.post('/update-price', (req, res) => {
  const { artikelnummer, neuerPreis } = req.body;

  if (!artikelnummer || typeof neuerPreis !== 'number') {
    return res.status(400).json({ error: 'Ungültige Eingabedaten' });
  }

  const getTablesQuery = "SHOW TABLES FROM nmnq9un4padignae";

  connection.query(getTablesQuery, (err, tables) => {
    if (err) {
      console.error('Fehler beim Abrufen der Tabellennamen:', err);
      return res.status(500).json({ error: 'Fehler beim Abrufen der Tabellennamen' });
    }

    const tableNames = tables
    .map(table => table[`Tables_in_nmnq9un4padignae`])
    .filter(name => name !== 'mhdartikel'); 
  

    const updatePromises = tableNames.map(tableName => {
      return new Promise((resolve, reject) => {
        const updateQuery = `
          UPDATE nmnq9un4padignae.\`${tableName}\`
          SET \`Preis/Stück\` = ?
          WHERE Artikelnummer = ?
        `;
        connection.query(updateQuery, [neuerPreis, artikelnummer], (err, result) => {
          if (err) {
            console.error(`Fehler beim Aktualisieren von Tabelle ${tableName}:`, err);
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
    });

    Promise.all(updatePromises)
      .then(() => {
        res.status(200).json({ message: 'Preis erfolgreich in allen Tabellen aktualisiert' });
      })
      .catch(error => {
        console.error('Fehler beim Aktualisieren des Preises:', error);
        res.status(500).json({ error: 'Fehler beim Aktualisieren des Preises in einer oder mehreren Tabellen' });
      });
  });
});

///////////////// Dashboard MHD Daten
app.get('/mhd-data', (req, res) => {
  const query = `
    SELECT Artikelname, mhd, Standort
    FROM mhdArtikel
    WHERE mhd IS NOT NULL
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Fehler beim Abrufen der MHD-Daten:', err);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }

    res.json(results);
  });
});

/////////////////////////// täglicher E-mail versand mit inhalt aller tables

///////////// tägliche excel senden

async function sendDailyExcel() {
  const workbook = new ExcelJS.Workbook();
  const filePath = path.join(__dirname, 'artikel_report.xlsx');

  try {
    // Tabellen abrufen
    const [tableResults] = await connection.promise().query('SHOW TABLES FROM nmnq9un4padignae');
    const allTables = tableResults.map(row => Object.values(row)[0]);

    // Ausgeschlossene Tabellen
    const excludedTables = ['mhdartikel', 'transferlager', 'e2etestlager'];
    const tablesToInclude = allTables.filter(table => !excludedTables.includes(table));

    for (const table of tablesToInclude) {
      const [data] = await connection.promise().query(
        `SELECT Artikelnummer, Artikelname, Anzahl FROM \`${table}\``
      );

      const worksheet = workbook.addWorksheet(table);

      if (data.length > 0) {
        worksheet.columns = [
          { header: 'Artikelnummer', key: 'Artikelnummer' },
          { header: 'Artikelname', key: 'Artikelname' },
          { header: 'Anzahl', key: 'Anzahl' }
        ];
        data.forEach(row => worksheet.addRow(row));
      }
    }

    await workbook.xlsx.writeFile(filePath);
    await sendMailWithAttachment(filePath);
    fs.unlinkSync(filePath);

    console.log(`[${new Date().toLocaleString()}] ✅ Excel erfolgreich versendet`);
  } catch (err) {
    console.error('❌ Fehler beim Erstellen/Senden der Excel:', err.message);
  }
}

async function sendMailWithAttachment(filePath) {
  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const mailOptions = {
    from: `"Lagerverwaltung" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_RECEIVER,
    subject: `📦 Täglicher Artikelbericht vom ${dateString}`,
    text: `Hallo,\n\nim Anhang findest du die Lagerdaten vom ${dateString}.\n\nBeste Grüße\nDeine Lagerverwaltung`,
    attachments: [{ filename: 'artikel_report.xlsx', path: filePath }]
  };

  await transporter.sendMail(mailOptions);
}





// Funktion für eine einfache Datenbankabfrage um den Timeout zu umgehen bei der Lagerhaltungsdatenbank
function keepAliveQuery() {
  const query = 'SELECT 1';
  connection.query(query, (err, results) => {
    if (err) {
      console.error('Fehler bei der Keep-Alive-Abfrage Lagerdatenbank:', err);
    } else {
      console.log('Keep-Alive-Abfrage erfolgreich für Lagerdatenbank ausgeführt');
    }
  });
}
// Führe die Keep-Alive-Abfrage alle 15 Minuten aus
setInterval(keepAliveQuery, 15 * 60 * 1000);

// Funktion für eine einfache Datenbankabfrage um den Timeout zu umgehen bei der Inventurdatenbank
function keepAliveQuery1() {
  const query = 'SELECT 1';
  inventurcon.query(query, (err, results) => {
    if (err) {
      console.error('Fehler bei der Keep-Alive-Abfrage Inventurdatenbank:', err);
    } else {
      console.log('Keep-Alive-Abfrage erfolgreich für Inventurdatenbank ausgeführt');
    }
  });
}
// Führe die Keep-Alive-Abfrage alle 15 Minuten aus
setInterval(keepAliveQuery1, 15 * 60 * 1000);

// Funktion für eine einfache Datenbankabfrage um den Timeout zu umgehen bei der Inventurdatenbank
function keepAliveQuery2() {
  const query = 'SELECT 1';
  dashboardcon.query(query, (err, results) => {
    if (err) {
      console.error('Fehler bei der Keep-Alive-Abfrage Dashboarddatenbank:', err);
    } else {
      console.log('Keep-Alive-Abfrage erfolgreich für Dashboarddatenbank ausgeführt');
    }
  });
}
// Führe die Keep-Alive-Abfrage alle 15 Minuten aus
setInterval(keepAliveQuery2, 15 * 60 * 1000);


app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer-Fehler:', err);
    return res.status(400).json({ 
      error: `Datei-Upload-Fehler: ${err.message} (Erwarteter Feldname: 'bild')`
    });
  }
  next(err);
});


let maintenanceMode = false; // Wartungsstatus speichern

// Endpunkt zum Abrufen des Wartungsstatus
app.get('/api/maintenance/status', (req, res) => {
  res.json({ maintenanceMode });
});

app.post('/api/maintenance/toggle', (req, res) => {
  maintenanceMode = !maintenanceMode;
  res.json({ maintenanceMode });
});


// Jeden Tag um 19:00 Uhr morgens
cron.schedule('0 19 * * *', () => {
  console.log('📧 Starte täglichen Excel-Versand...');
  sendDailyExcel();
});


// Server starten
const PORT = process.env.PORT || 3000; // Standardport für lokale Entwicklung
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
