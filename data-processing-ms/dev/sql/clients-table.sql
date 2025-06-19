-- Crear la base de datos si no existe
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'ChallengeDB')
BEGIN
    CREATE DATABASE ChallengeDB;
    PRINT 'Base de datos ChallengeDB creada.';
END
GO

-- Cambiar al contexto de la nueva base de datos
USE ChallengeDB;
GO

-- Crear la tabla si no existe
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Clients' and xtype='U')
BEGIN
    CREATE TABLE Clients (
        ID_Cliente INT PRIMARY KEY,
        Nombre NVARCHAR(100) NOT NULL,
        Apellido NVARCHAR(100) NOT NULL,
        Email NVARCHAR(255) UNIQUE NOT NULL,
        FechaNacimiento DATE,
        DireccionCompleta NVARCHAR(500),
        Ciudad NVARCHAR(100),
        Pais NVARCHAR(100),
        Telefono NVARCHAR(50),
        FechaRegistro DATETIME2
    );
    PRINT 'Tabla Clients creada.';
END
ELSE
BEGIN
    PRINT 'La tabla Clients ya existe.';
END
GO